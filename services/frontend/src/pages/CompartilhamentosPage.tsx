import { useState, useEffect } from 'react'
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
import { ListPageTable } from '../components/ListPageTable'
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
  cadastroFieldCls,
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import type { BadgeTone } from '../utils/badgeTones'
import Toast from '../components/Toast'
import { Edit2, Trash2, Users, Lock } from 'lucide-react'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'
import { formatAccountDisplay } from '../utils/accountFormatter'

function percentageTone(percentage: number): BadgeTone {
  if (percentage > 80) return 'brand1'
  if (percentage > 60) return 'brand2'
  if (percentage > 40) return 'brand3'
  if (percentage > 20) return 'brand4'
  return 'brand5'
}

interface Bank {
  id: number
  code: string
  name: string
  full_name?: string
}

interface Account {
  id: number
  name?: string
  description?: string
  bank?: Bank
  agency?: string
  account_number?: string
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description?: string
  active: boolean
  shared_account?: Account
  is_inverse?: boolean  // True quando visualizado pela contraparte (somente leitura)
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const CompartilhamentosPage = () => {
  const [compartilhamentos, setCompartilhamentos] = useState<ExpenseSharing[]>([])
  const [minhasOutrasContas, setMinhasOutrasContas] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCompartilhamento, setEditingCompartilhamento] = useState<ExpenseSharing | null>(null)
  const [formData, setFormData] = useState({
    shared_account_id: '',
    my_contribution_percentage: '50.00',
    description: ''
  })
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Formata agência com máscara xxxxx-x (5 dígitos + 1 verificador)
  const formatAgency = (agency?: string | number) => {
    if (!agency) return '-'
    const agencyStr = agency.toString().padStart(6, '0')  // Padding para 6 dígitos (5+1)
    const lastDigit = agencyStr.slice(-1)
    const firstPart = agencyStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Formata número da conta com máscara xxxxxxxxx-x (9 dígitos + 1 verificador)
  const formatAccount = (accountNumber?: string | number) => {
    if (!accountNumber) return '-'
    const accountStr = accountNumber.toString().padStart(10, '0')  // Padding para 10 dígitos (9+1)
    const lastDigit = accountStr.slice(-1)
    const firstPart = accountStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  useEffect(() => {
    carregarCompartilhamentos()
    carregarMinhasOutrasContas()
  }, [])

  // Atalhos de teclado para o modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        fecharModal()
      } else if (e.key === 'Enter' && showModal && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    }

    if (showModal) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showModal, formData])

  const carregarCompartilhamentos = async () => {
    try {
      setLoading(true)
      // Buscar TODOS os compartilhamentos (incluindo inativos)
      const response = await axios.get('/api/expense-sharing/?incluir_inativos=true')
      setCompartilhamentos(response.data)
    } catch (error) {
      console.error('Erro ao carregar compartilhamentos:', error)
      showToast('Erro ao carregar compartilhamentos', 'error')
    } finally {
      setLoading(false)
    }
  }

  const carregarMinhasOutrasContas = async () => {
    try {
      const response = await axios.get('/api/expense-sharing/my-other-accounts')
      setMinhasOutrasContas(response.data)
    } catch (error) {
      console.error('Erro ao carregar outras contas:', error)
      showToast('Erro ao carregar contas disponíveis', 'error')
    }
  }

  const abrirModalNovo = async () => {
    setEditingCompartilhamento(null)
    setFormData({
      shared_account_id: '',
      my_contribution_percentage: '50.00',
      description: ''
    })
    // Recarregar contas disponíveis antes de abrir o modal
    await carregarMinhasOutrasContas()
    setShowModal(true)
  }

  const abrirModalEditar = (compartilhamento: ExpenseSharing) => {
    setEditingCompartilhamento(compartilhamento)
    setFormData({
      shared_account_id: compartilhamento.shared_account_id.toString(),
      my_contribution_percentage: compartilhamento.my_contribution_percentage.toString(),
      description: compartilhamento.description || ''
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingCompartilhamento(null)
    setFormData({
      shared_account_id: '',
      my_contribution_percentage: '50.00',
      description: ''
    })
  }

  const handleSubmit = async () => {
    try {
      const payload: any = {
        my_contribution_percentage: parseFloat(formData.my_contribution_percentage),
        description: formData.description || null
      }

      if (editingCompartilhamento) {
        // Atualizar
        await axios.put(
          `/api/expense-sharing/${editingCompartilhamento.id}`,
          payload
        )
        showToast('Compartilhamento atualizado com sucesso!', 'success')
      } else {
        // Criar
        payload.shared_account_id = parseInt(formData.shared_account_id)
        await axios.post('/api/expense-sharing/', payload)
        showToast('Compartilhamento criado com sucesso!', 'success')
      }

      fecharModal()
      await carregarCompartilhamentos()
    } catch (error: any) {
      console.error('Erro ao salvar compartilhamento:', error)
      const errorMessage = error.response?.data?.detail || 'Erro ao salvar compartilhamento'
      showToast(errorMessage, 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Compartilhamento',
      'Tem certeza que deseja inativar este compartilhamento?',
      async () => {
        try {
          await axios.put(`/api/expense-sharing/${id}/inactivate`)
          showToast('Compartilhamento inativado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao inativar compartilhamento:', error)
          showToast('Erro ao inativar compartilhamento', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Compartilhamento',
      'Tem certeza que deseja reativar este compartilhamento?',
      async () => {
        try {
          await axios.put(`/api/expense-sharing/${id}/reactivate`)
          showToast('Compartilhamento reativado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao reativar compartilhamento:', error)
          showToast('Erro ao reativar compartilhamento', 'error')
        }
      },
      'Reativar',
      'Cancelar'
    )
  }

  const handleDeletar = (id: number) => {
    showConfirm(
      'Deletar Compartilhamento',
      'Tem certeza que deseja deletar permanentemente este compartilhamento? Esta ação não pode ser desfeita.',
      async () => {
        try {
          await axios.delete(`/api/expense-sharing/${id}`)
          showToast('Compartilhamento deletado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao deletar compartilhamento:', error)
          showToast('Erro ao deletar compartilhamento', 'error')
        }
      },
      'Deletar',
      'Cancelar'
    )
  }



  const compartilhamentosAtivos = compartilhamentos.filter((c) => c.active)
  const compartilhamentosInativos = compartilhamentos.filter((c) => !c.active)
  const compartilhamentosFiltrados = statusFilter === 'active'
    ? compartilhamentosAtivos
    : statusFilter === 'inactive'
      ? compartilhamentosInativos
      : compartilhamentos

  const handleToggleActive = (comp: ExpenseSharing) => {
    if (comp.is_inverse) return
    if (comp.active) handleInativar(comp.id)
    else handleReativar(comp.id)
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Users className="w-8 h-8" />}
              title="Configurações de Compartilhamento"
              subtitle="Configure como dividir despesas com outras contas"
              actions={<CadastroListCreateButton label="Novo Compartilhamento" onClick={abrirModalNovo} />}
            />
          }
          tabs={
            compartilhamentos.length > 0 ? (
              <CadastroListPageTabs
                tabs={[
                  { key: 'all', label: 'Todos', count: compartilhamentos.length },
                  { key: 'active', label: 'Ativos', count: compartilhamentosAtivos.length },
                  { key: 'inactive', label: 'Inativos', count: compartilhamentosInativos.length },
                ]}
                active={statusFilter}
                onChange={setStatusFilter}
              />
            ) : undefined
          }
          contentOverflow="auto"
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando compartilhamentos…" />
          ) : compartilhamentos.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Users size={32} className="text-gray-400" />}
              title="Nenhum compartilhamento cadastrado"
              description="Comece adicionando seu primeiro compartilhamento de despesas"
              action={<CadastroListCreateButton label="Adicionar Compartilhamento" onClick={abrirModalNovo} />}
            />
          ) : compartilhamentosFiltrados.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Users size={32} className="text-gray-400" />}
              title={statusFilter === 'inactive' ? 'Nenhum compartilhamento inativo' : 'Nenhum compartilhamento ativo'}
              description="Não há compartilhamentos neste filtro."
            />
          ) : (
            <ListPageTable
              colsRest={<ListTableSpacerCol />}
              head={
                <tr>
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Conta" className="w-[16%]" />
                  <ListTableStaticHeader label="Banco" className="w-[16%]" />
                  <ListTableStaticHeader label="Agência" className="w-[10%]" />
                  <ListTableStaticHeader label="Conta nº" className="w-[10%]" />
                  <ListTableStaticHeader label="Descrição" className="w-[16%]" />
                  <ListTableStaticHeader label="Minha parte" className="w-[10%]" />
                  <ListTableStaticHeader label="Contraparte" className="w-[10%]" />
                  <ListTableStaticHeader label="Status" className="w-[8%]" />
                  <ListTableStaticHeader label="Ações" className="w-[8%]" />
                </tr>
              }
            >
              {compartilhamentosFiltrados.map((comp, index) => {
                const minhaContribuicao = Number(comp.my_contribution_percentage)
                const outraContaPaga = 100 - minhaContribuicao
                return (
                  <tr
                    key={comp.id}
                    className={`${listPageTableRowHoverCls} ${!comp.active ? listPageTableRowInactiveCls : ''}`}
                  >
                    <ListTableIndexCell index={index + 1} />
                    <ListTableSpacerCell />
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex-shrink-0 rounded-md p-1.5 shadow-sm"
                          style={{ background: 'var(--gradient-1-2)' }}
                        >
                          <Users size={15} style={{ color: 'var(--on-gradient-1-2)' }} />
                        </div>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {comp.shared_account?.name || '—'}
                        </span>
                        {comp.is_inverse && (
                          <Badge
                            variant={badgeVariantForColumnRole('scope')}
                            tone="neutral"
                            label="Contraparte"
                            title="Configurado pela conta parceira — somente leitura"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {comp.shared_account?.bank?.code || '—'} · {comp.shared_account?.bank?.name || '—'}
                    </td>
                    <td className="px-3 py-3 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                      {comp.shared_account?.agency ? formatAgency(comp.shared_account.agency) : '—'}
                    </td>
                    <td className="px-3 py-3 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                      {comp.shared_account?.account_number
                        ? formatAccount(comp.shared_account.account_number)
                        : '—'}
                    </td>
                    <td className="truncate px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {comp.description || '—'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={badgeVariantForColumnRole('statusPrimary')}
                        tone={percentageTone(minhaContribuicao)}
                        label={`${minhaContribuicao}%`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={badgeVariantForColumnRole('classificationSecondary')}
                        tone={percentageTone(outraContaPaga)}
                        label={`${outraContaPaga}%`}
                      />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {comp.is_inverse ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-gray-400"
                          title="Apenas a conta que criou pode alterar o status"
                        >
                          <Lock size={12} />
                          {comp.active ? 'Ativo' : 'Inativo'}
                        </span>
                      ) : (
                        <StatusSwitch
                          checked={comp.active}
                          onChange={() => handleToggleActive(comp)}
                          size="sm"
                          labelOn="Ativo"
                          labelOff="Inativo"
                          showLabel
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {comp.is_inverse ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => abrirModalEditar(comp)}
                            className={cadastroRowIconBtnCls}
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletar(comp.id)}
                            className={cadastroRowIconDangerCls}
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </ListPageTable>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {showModal && (
        <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={fecharModal}>
          <CadastroModalHeader
            isEdit={!!editingCompartilhamento}
            title={editingCompartilhamento ? 'Editar Compartilhamento' : 'Novo Compartilhamento'}
            subtitle="Divisão de despesas com outra conta"
            onClose={fecharModal}
            icon={<Users size={18} />}
          />
          <form
            className="flex min-h-0 flex-1 flex-col"
            id="compartilhamento-form"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
          >
            <CadastroModalBody>
              <CadastroFormSection title="Conta parceira" icon={<Users size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Compartilhar com</CadastroFieldLabel>
                      {minhasOutrasContas.length === 0 ? (
                        <div className={`${cadastroFieldCls} mt-0.5 text-gray-500`}>Carregando contas disponíveis…</div>
                      ) : (
                        <select
                          value={formData.shared_account_id}
                          onChange={(e) => setFormData({ ...formData, shared_account_id: e.target.value })}
                          disabled={!!editingCompartilhamento}
                          className={`${cadastroFieldCls} mt-0.5`}
                          required
                        >
                          <option value="">Selecione uma conta…</option>
                          {minhasOutrasContas.map((conta) => (
                            <option key={conta.id} value={conta.id}>
                              {formatAccountDisplay(conta)}
                            </option>
                          ))}
                        </select>
                      )}
                      {editingCompartilhamento && (
                        <p className="mt-1 text-xs text-gray-500">A conta compartilhada não pode ser alterada após a criação</p>
                      )}
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Minha contribuição (%)</CadastroFieldLabel>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={formData.my_contribution_percentage}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value === '' || (parseFloat(value) >= 0 && parseFloat(value) <= 100)) {
                            setFormData({ ...formData, my_contribution_percentage: value })
                          }
                        }}
                        className={`${cadastroFieldCls} mt-0.5`}
                        required
                      />
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                        <span>Minha parte: {formData.my_contribution_percentage}%</span>
                        <span>Outra conta: {100 - parseFloat(formData.my_contribution_percentage || '0')}%</span>
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                        className={`${cadastroFieldCls} mt-0.5 resize-none`}
                        placeholder="Observações sobre este compartilhamento…"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={fecharModal}
              onSave={() => void handleSubmit()}
              disabled={!formData.shared_account_id || !formData.my_contribution_percentage}
              saveLabel={editingCompartilhamento ? 'Atualizar' : 'Criar'}
            />
          </form>
        </CadastroModalShell>
      )}

      {/* Toast */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmComponent />
    </div>
  )
}

export default CompartilhamentosPage

