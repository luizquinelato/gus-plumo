import { useState, useEffect, Fragment } from 'react'
import Sidebar from '../components/Sidebar'
import {
  CadastroListCreateButton,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableRowHoverCls,
  listPageTableRowInactiveCls,
  type StatusFilter,
} from '../components/CadastroListPageLayout'
import { ListPageExpandRow, ListPageNestedTable, ListPageTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
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
  cadastroOptionLabelCls,
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { badgeToneMap } from '../utils/badgePalettes'
import Toast from '../components/Toast'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { ChevronDown, ChevronRight, Edit2, Trash2, CreditCard, Layers, CheckSquare, Square, MinusSquare } from 'lucide-react'
import { formatSharedAccountDisplay } from '../utils/accountFormatter'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'
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
  expense_sharing?: ExpenseSharing
  active: boolean
  closing_day?: number
  is_account_card?: boolean | null
  invoice_group_id?: number | null
  invoice_group_name?: string | null
}

interface InvoiceGroup {
  id: number
  name: string
  account_id: number
  active: boolean
  card_count: number
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const OWNERSHIP_TONE = badgeToneMap(['proprio', 'compartilhado'] as const, 'brand')
const CARD_TYPE_TONE = badgeToneMap(['credito', 'beneficios'] as const, 'brand')

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
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<InvoiceGroup | null>(null)
  const [groupName, setGroupName] = useState('')
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
    closing_day: '14',
    is_account_card: false,
    active: true,
  })
  const [originalOwnershipType, setOriginalOwnershipType] = useState<string>('proprio')
  const [originalExpenseSharingId, setOriginalExpenseSharingId] = useState<number | null>(null)
  const [updateExistingRecords, setUpdateExistingRecords] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    carregarCompartilhamentos()
    carregarCartoes()
    carregarGrupos()
  }, [])

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

  const fecharModalGrupo = () => {
    setShowGroupModal(false)
    setEditingGroup(null)
    setGroupName('')
    setGroupCardIds([])
    setSavingGroup(false)
  }

  const abrirModalGrupoNovo = () => {
    setEditingGroup(null)
    setGroupName('')
    setGroupCardIds([])
    setShowGroupModal(true)
  }

  const abrirModalGrupoEditar = (group: InvoiceGroup) => {
    setEditingGroup(group)
    setGroupName(group.name)
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
  const allGroupCardsSelected =
    creditCardIds.length > 0 && creditCardIds.every((id) => groupCardIds.includes(id))
  const someGroupCardsSelected = creditCardIds.some((id) => groupCardIds.includes(id))

  const toggleSelectAllGroupCards = () => {
    setGroupCardIds(allGroupCardsSelected ? [] : creditCardIds)
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
      if (editingGroup) {
        await axios.put(`/api/cartoes/invoice-groups/${editingGroup.id}`, {
          name,
          card_ids: groupCardIds,
        })
        showToast('Grupo atualizado', 'success')
      } else {
        await axios.post('/api/cartoes/invoice-groups', {
          name,
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
        is_account_card: formData.is_account_card,
        active: formData.active,
      }

      // Adicionar expense_sharing_id se ownership_type for 'compartilhado', senão null
      if (formData.ownership_type === 'compartilhado' && formData.expense_sharing_id) {
        payload.expense_sharing_id = parseInt(formData.expense_sharing_id)
      } else {
        payload.expense_sharing_id = null
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
      closing_day: '14',
      is_account_card: false,
      active: true,
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
      closing_day: cartao.closing_day?.toString() || '14',
      is_account_card: cartao.is_account_card === true,
      active: cartao.active !== false,
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
      closing_day: '14',
      is_account_card: false,
      active: true,
    })
  }

  const getOwnershipTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'proprio': 'Próprio',
      'compartilhado': 'Compartilhado'
    }
    return labels[type] || type
  }

  const cartoesAtivos = cartoes.filter((c) => c.active)
  const cartoesInativos = cartoes.filter((c) => !c.active)
  const cartoesFiltrados = statusFilter === 'active'
    ? cartoesAtivos
    : statusFilter === 'inactive'
      ? cartoesInativos
      : cartoes

  const groupedRows = invoiceGroups
    .map((group) => ({
      group,
      cards: cartoesFiltrados.filter((c) => c.type === 'credito' && c.invoice_group_id === group.id),
    }))
    .filter((item) => item.cards.length > 0)
  const ungroupedCards = cartoesFiltrados.filter((c) => c.type !== 'credito' || !c.invoice_group_id)

  const toggleGroupCollapse = (id: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleActive = (cartao: Cartao) => {
    if (cartao.active) handleInativar(cartao.id)
    else handleReativar(cartao.id)
  }

  const renderCartaoDataCells = (cartao: Cartao, compact = false) => {
    const pad = compact ? 'px-3 py-2' : 'px-3 py-3'
    return (
      <>
        <td className={pad}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-shrink-0 rounded-md p-1.5 shadow-sm" style={{ background: 'var(--gradient-1-2)' }}>
              <CreditCard size={compact ? 14 : 15} style={{ color: 'var(--on-gradient-1-2)' }} />
            </div>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{cartao.name}</span>
            <Badge
              variant={badgeVariantForColumnRole('statusPrimary')}
              tone={cartao.is_account_card ? 'success' : 'neutral'}
              label={cartao.is_account_card ? 'Da conta' : 'Gerenciado'}
              title={
                cartao.is_account_card
                  ? 'Incluído na Saúde Financeira pelo valor integral'
                  : 'Cartão gerenciado: entra na Saúde se houver linhas com % > 0, já rateadas'
              }
            />
          </div>
        </td>
        <td className={`${pad} font-mono text-sm text-gray-500 dark:text-gray-400`}>•••• {cartao.number}</td>
        <td className={pad}>
          <Badge
            variant={badgeVariantForColumnRole('classificationSecondary')}
            tone={cartao.ownership_type === 'compartilhado' ? OWNERSHIP_TONE.compartilhado : OWNERSHIP_TONE.proprio}
            label={getOwnershipTypeLabel(cartao.ownership_type)}
          />
        </td>
        <td className={pad}>
          <Badge
            variant={badgeVariantForColumnRole('classificationPrimary')}
            tone={cartao.type === 'beneficios' ? CARD_TYPE_TONE.beneficios : CARD_TYPE_TONE.credito}
            label={cartao.type === 'credito' ? 'Crédito' : 'Benefícios'}
          />
        </td>
        <td className={`${pad} text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100`}>
          {cartao.closing_day || 14}
        </td>
        <td className={`${pad} text-sm text-gray-500`}>
          {cartao.ownership_type === 'compartilhado' && cartao.expense_sharing?.shared_account ? (
            <SharedAccountDisplay
              account={cartao.expense_sharing.shared_account}
              ownershipPercentage={cartao.expense_sharing.my_contribution_percentage}
            />
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className={pad} onClick={(e) => e.stopPropagation()}>
          <StatusSwitch
            checked={cartao.active}
            onChange={() => handleToggleActive(cartao)}
            size="sm"
            labelOn="Ativo"
            labelOff="Inativo"
            showLabel
          />
        </td>
        <td className={pad}>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => abrirModalEditar(cartao)} className={cadastroRowIconBtnCls} title="Editar">
              <Edit2 size={15} />
            </button>
            <button type="button" onClick={() => handleDelete(cartao.id)} className={cadastroRowIconDangerCls} title="Excluir">
              <Trash2 size={15} />
            </button>
          </div>
        </td>
      </>
    )
  }

  const renderCartaoRow = (cartao: Cartao, index: number | string) => (
    <tr
      key={cartao.id}
      className={`${listPageTableRowHoverCls} ${!cartao.active ? listPageTableRowInactiveCls : ''}`}
    >
      <ListTableIndexCell index={index} />
      <ListTableSpacerCell />
      {renderCartaoDataCells(cartao)}
    </tr>
  )

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
          header={
            <CadastroListPageHero
              icon={<CreditCard className="w-8 h-8" />}
              title="Gerenciar Cartões"
              subtitle="Cadastre e gerencie seus cartões de crédito"
              actions={
                <>
                  <button
                    type="button"
                    onClick={abrirModalGrupoNovo}
                    disabled={cartoesCreditoAtivos.length < 2}
                    title={
                      cartoesCreditoAtivos.length < 2
                        ? 'Cadastre pelo menos dois cartões de crédito para criar um grupo'
                        : 'Agrupar cartões na mesma boleta'
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-opacity hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    <Layers size={18} />
                    Novo Grupo
                  </button>
                  <CadastroListCreateButton label="Novo Cartão" onClick={abrirModalNovo} />
                </>
              }
            />
          }
          tabs={
            cartoes.length > 0 ? (
              <CadastroListPageTabs
                tabs={[
                  { key: 'all', label: 'Todos', count: cartoes.length },
                  { key: 'active', label: 'Ativos', count: cartoesAtivos.length },
                  { key: 'inactive', label: 'Inativos', count: cartoesInativos.length },
                ]}
                active={statusFilter}
                onChange={setStatusFilter}
              />
            ) : undefined
          }
          contentOverflow="auto"
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando cartões…" />
          ) : cartoes.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<CreditCard size={32} className="text-gray-400" />}
              title="Nenhum cartão cadastrado"
              description="Comece adicionando seu primeiro cartão de crédito"
              action={<CadastroListCreateButton label="Adicionar Cartão" onClick={abrirModalNovo} />}
            />
          ) : cartoesFiltrados.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<CreditCard size={32} className="text-gray-400" />}
              title={statusFilter === 'inactive' ? 'Nenhum cartão inativo' : 'Nenhum cartão ativo'}
              description="Não há cartões neste filtro."
            />
          ) : (
            <ListPageTable
              colsRest={<ListTableSpacerCol />}
              head={
                <tr>
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Nome" className="w-[20%]" />
                  <ListTableStaticHeader label="Últimos 4" className="w-[11%]" />
                  <ListTableStaticHeader label="Propriedade" className="w-[12%]" />
                  <ListTableStaticHeader label="Tipo" className="w-[11%]" />
                  <ListTableStaticHeader label="Fechamento" className="w-[10%]" />
                  <ListTableStaticHeader label="Compartilhamento" className="w-[15%]" />
                  <ListTableStaticHeader label="Status" className="w-[10%]" />
                  <ListTableStaticHeader label="Ações" className="w-[8%]" />
                </tr>
              }
            >
              {groupedRows.map(({ group, cards }, groupIndex) => {
                const expanded = !collapsedGroups.has(group.id)
                const closingDays = [...new Set(cards.map((c) => c.closing_day || 14))].sort((a, b) => a - b)
                const activeCount = cards.filter((c) => c.active).length
                const allInactive = cards.length > 0 && activeCount === 0
                return (
                  <Fragment key={`group-${group.id}`}>
                    <tr
                      className={`${listPageTableRowHoverCls} ${allInactive ? listPageTableRowInactiveCls : ''} ${
                        expanded
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_4%,transparent)] [&>td]:border-b-0'
                          : ''
                      }`}
                    >
                      <ListTableIndexCell index={groupIndex + 1} />
                      <ListTableSpacerCell />
                      <td className="cursor-pointer px-3 py-3" onClick={() => toggleGroupCollapse(group.id)}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleGroupCollapse(group.id)
                            }}
                            className={cadastroRowIconBtnCls}
                            title={expanded ? 'Recolher' : 'Expandir'}
                          >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <Layers
                            size={15}
                            className="shrink-0"
                            style={{ color: expanded ? 'var(--color-1)' : undefined }}
                          />
                          <span
                            className={`text-sm font-semibold ${
                              expanded ? 'text-[var(--color-1)]' : 'text-gray-800 dark:text-gray-100'
                            }`}
                          >
                            {group.name}
                          </span>
                          <Badge
                            variant={badgeVariantForColumnRole('metricGhost')}
                            tone="brand3"
                            label={cards.length}
                            title="Cartões na mesma boleta"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-400">—</td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={badgeVariantForColumnRole('scope')}
                          tone="brand4"
                          label="Conjunta"
                          title="Fatura conjunta"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={badgeVariantForColumnRole('classificationPrimary')}
                          tone={CARD_TYPE_TONE.credito}
                          label="Crédito"
                        />
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                        {closingDays.join(' · ')}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-400">—</td>
                      <td className="px-3 py-3 text-xs font-medium text-gray-500">
                        {activeCount}/{cards.length} ativos
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => abrirModalGrupoEditar(group)}
                            className={cadastroRowIconBtnCls}
                            title="Editar grupo"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => excluirGrupo(group)}
                            className={cadastroRowIconDangerCls}
                            title="Excluir grupo"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <ListPageExpandRow colSpan={10}>
                        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-1)]">
                          Cartões na mesma boleta
                        </h4>
                        <ListPageNestedTable
                          head={
                            <tr>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">#</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Nome</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Últimos 4</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Propriedade</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tipo</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Fechamento</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Compartilhamento</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ações</th>
                            </tr>
                          }
                        >
                          {cards.map((cartao, cardIndex) => (
                            <tr
                              key={cartao.id}
                              className={`${listPageTableRowHoverCls} ${!cartao.active ? listPageTableRowInactiveCls : ''}`}
                            >
                              <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{cardIndex + 1}</td>
                              {renderCartaoDataCells(cartao, true)}
                            </tr>
                          ))}
                        </ListPageNestedTable>
                      </ListPageExpandRow>
                    )}
                  </Fragment>
                )
              })}
              {ungroupedCards.map((cartao, index) =>
                renderCartaoRow(cartao, groupedRows.length + index + 1),
              )}
            </ListPageTable>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {showModal && (
        <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={fecharModal}>
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
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
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
                      <CadastroFieldLabel required>Dia de Fechamento</CadastroFieldLabel>
                      <input
                        type="number"
                        value={formData.closing_day}
                        onChange={(e) => setFormData({ ...formData, closing_day: e.target.value })}
                        required
                        min={1}
                        max={30}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: 14"
                      />
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Tipo de Propriedade</CadastroFieldLabel>
                      <select
                        value={formData.ownership_type}
                        onChange={(e) => setFormData({
                          ...formData,
                          ownership_type: e.target.value
                        })}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                      >
                        <option value="proprio">Próprio</option>
                        <option value="compartilhado">Compartilhado</option>
                      </select>
                    </label>
                  </CadastroModalFieldsRow>
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
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Regras" icon={<Layers size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className={`${cadastroOptionLabelCls} items-start`}>
                      <input
                        type="checkbox"
                        checked={formData.is_account_card}
                        onChange={(e) => setFormData({ ...formData, is_account_card: e.target.checked })}
                        className={`${cadastroAccentControlCls} mt-1 h-4 w-4 rounded border-gray-300`}
                      />
                      <span>
                        <span className="block text-sm font-medium">Cartão da conta</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Marque se este cartão é gasto real da conta (entra na Saúde Financeira). Desmarcado =
                          terceiro gerenciado.
                        </span>
                      </span>
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
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Compartilhamento</CadastroFieldLabel>
                        <select
                          value={formData.expense_sharing_id}
                          onChange={(e) => setFormData({ ...formData, expense_sharing_id: e.target.value })}
                          required
                          className={`${cadastroFieldCls} mt-0.5`}
                        >
                          <option value="">Selecione um compartilhamento...</option>
                          {compartilhamentos.map(comp => (
                            <option key={comp.id} value={comp.id}>
                              {formatSharedAccountDisplay(comp.shared_account, comp.my_contribution_percentage)}
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
                  ) : null}
                  {editingCartao && (() => {
                    const currentExpenseSharingId = formData.ownership_type === 'compartilhado' && formData.expense_sharing_id
                      ? parseInt(formData.expense_sharing_id)
                      : null
                    const ownershipTypeChanged = originalOwnershipType !== formData.ownership_type
                    const sharingIdChanged = originalExpenseSharingId !== currentExpenseSharingId
                    const hasSharingChange = ownershipTypeChanged || sharingIdChanged
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
                              ) : (
                                'Ao marcar esta opção, todos os registros existentes nas tabelas de extrato bancário, faturas de cartão e benefícios terão o compartilhamento removido (100% próprio).'
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
        <CadastroModalShell maxWidth="max-w-4xl" onBackdropClick={fecharModalGrupo}>
          <CadastroModalHeader
            isEdit={!!editingGroup}
            title={editingGroup ? 'Editar grupo de fatura' : 'Novo grupo de fatura'}
            subtitle="Clique nos cartões que saem na mesma boleta. É preciso pelo menos dois."
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
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection
              title="Cartões de crédito"
              icon={<CreditCard size={14} />}
              trailing={
                <div className="flex items-center gap-3">
                  {cartoesCredito.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAllGroupCards}
                      className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                      title={allGroupCardsSelected ? 'Limpar seleção' : 'Selecionar todos'}
                    >
                      {allGroupCardsSelected ? (
                        <CheckSquare size={18} className="text-[var(--color-1)]" />
                      ) : someGroupCardsSelected ? (
                        <MinusSquare size={18} className="text-[var(--color-1)]" />
                      ) : (
                        <Square size={18} className="text-gray-400" />
                      )}
                      Selecionar todos
                    </button>
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {groupCardIds.length} selecionado{groupCardIds.length === 1 ? '' : 's'}
                  </span>
                </div>
              }
            >

                {cartoes.filter((c) => c.type === 'credito').length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-600">
                    Nenhum cartão de crédito cadastrado.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {cartoes
                      .filter((c) => c.type === 'credito')
                      .map((cartao) => {
                        const selected = groupCardIds.includes(cartao.id)
                        const otherGroup =
                          cartao.invoice_group_id &&
                          cartao.invoice_group_id !== editingGroup?.id
                            ? cartao.invoice_group_name
                            : null
                        const statusLabel = otherGroup
                          ? `Hoje em ${otherGroup} — será movido`
                          : cartao.invoice_group_id === editingGroup?.id
                            ? 'Neste grupo'
                            : !cartao.active
                              ? 'Inativo · sem grupo'
                              : 'Sem grupo'
                        return (
                          <button
                            key={cartao.id}
                            type="button"
                            onClick={() => toggleGroupCard(cartao.id)}
                            className={`rounded-xl border p-4 text-left shadow-sm transition-all ${
                              cartao.active ? '' : 'opacity-60'
                            } ${
                              selected
                                ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_8%,white)] ring-2 ring-[var(--color-1)] dark:bg-[color-mix(in_srgb,var(--color-1)_16%,transparent)]'
                                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                                  selected
                                    ? 'text-[var(--on-color-1,white)]'
                                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                                }`}
                                style={selected ? { backgroundColor: 'var(--color-1)' } : undefined}
                              >
                                <CreditCard size={18} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                                    {cartao.name}
                                  </span>
                                  <span
                                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                                      selected
                                        ? 'border-[var(--color-1)] bg-[var(--color-1)] text-white'
                                        : 'border-gray-300 bg-white dark:border-gray-500 dark:bg-gray-700'
                                    }`}
                                  >
                                    {selected ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
                                  </span>
                                </span>
                                <span className="mt-0.5 block font-mono text-sm text-gray-500 dark:text-gray-400">
                                  •••• {cartao.number}
                                </span>
                                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                      cartao.is_account_card
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                    }`}
                                  >
                                    {cartao.is_account_card ? 'Da conta' : 'Gerenciado'}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {statusLabel}
                                  </span>
                                </span>
                              </span>
                            </div>
                          </button>
                        )
                      })}
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
      <ConfirmComponent />
    </div>
  )
}

export default CartoesPage

