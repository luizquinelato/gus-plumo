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
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroFormSection,
  CadastroModalShell,
  cadastroFieldCls,
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { badgeToneMap } from '../utils/badgePalettes'
import Toast from '../components/Toast'
import { Edit2, Trash2, Building2, Landmark } from 'lucide-react'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'

interface Bank {
  id: number
  code: string
  name: string
  full_name?: string
  ispb?: string
  active: boolean
}

interface Conta {
  id: number
  user_id: number
  name?: string
  description?: string
  account_type?: string
  bank_id?: number
  bank?: Bank
  agency?: number
  account_number?: number
  active: boolean
  last_updated_at?: string
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const ACCOUNT_TYPE_TONE = badgeToneMap(['corrente', 'poupanca', 'investimento'] as const, 'brand')

const ContasPage = () => {
  const [contas, setContas] = useState<Conta[]>([])
  const [bancos, setBancos] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingConta, setEditingConta] = useState<Conta | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    account_type: '',
    bank_id: '',
    agency: '',
    account_number: ''
  })

  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    carregarContas()
    carregarBancos()
  }, [])

  // Atalhos de teclado para o modal
  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharModal()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Verifica se o foco não está em um textarea ou select
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          // Dispara o submit do formulário
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

  const carregarBancos = async () => {
    try {
      const response = await axios.get('/api/accounts/banks')
      setBancos(response.data)
    } catch (error) {
      console.error('Erro ao carregar bancos:', error)
      showToast('Erro ao carregar lista de bancos', 'error')
    }
  }

  const carregarContas = async () => {
    try {
      const response = await axios.get('/api/accounts/?incluir_inativos=true')
      setContas(response.data)
    } catch (error) {
      console.error('Erro ao carregar contas:', error)
      showToast('Erro ao carregar contas', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Valida que o número da conta não seja zero
    if (formData.account_number && parseInt(formData.account_number) === 0) {
      showToast('Número da conta inválido: não pode ser zero.', 'error')
      return
    }

    try {
      // Converte bank_id, agency e account_number para número
      const payload = {
        ...formData,
        bank_id: formData.bank_id ? parseInt(formData.bank_id) : null,
        agency: formData.agency ? parseInt(formData.agency) : null,
        account_number: formData.account_number ? parseInt(formData.account_number) : null
      }

      if (editingConta) {
        await axios.put(`/api/accounts/${editingConta.id}`, payload)
      } else {
        await axios.post('/api/accounts/', payload)
      }

      await carregarContas()
      fecharModal()
      showToast(editingConta ? 'Conta atualizada com sucesso!' : 'Conta criada com sucesso!', 'success')
    } catch (error: any) {
      console.error('Erro ao salvar conta:', error)
      showToast(error.response?.data?.detail || error.message || 'Erro ao salvar conta', 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Conta',
      'Tem certeza que deseja inativar esta conta?\n\nEla será movida para a seção de contas inativas.',
      async () => {
        try {
          await axios.put(`/api/accounts/${id}`, { active: false })
          await carregarContas()
          showToast('Conta inativada com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao inativar conta:', error)
          showToast('Erro ao inativar conta', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Conta',
      'Tem certeza que deseja reativar esta conta?\n\nEla será movida de volta para a seção de contas ativas.',
      async () => {
        try {
          await axios.put(`/api/accounts/${id}`, { active: true })
          await carregarContas()
          showToast('Conta reativada com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao reativar conta:', error)
          showToast('Erro ao reativar conta', 'error')
        }
      },
      'Reativar',
      'Cancelar'
    )
  }

  const handleDelete = (id: number) => {
    showConfirm(
      'Deletar Permanentemente',
      '⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nTem certeza que deseja DELETAR PERMANENTEMENTE esta conta?\n\nTodos os dados relacionados serão perdidos.',
      async () => {
        try {
          await axios.delete(`/api/accounts/${id}`)
          await carregarContas()
          showToast('Conta deletada permanentemente!', 'success')
        } catch (error) {
          console.error('Erro ao deletar conta:', error)
          showToast('Erro ao deletar conta', 'error')
        }
      },
      'Deletar Permanentemente',
      'Cancelar'
    )
  }

  const abrirModalNovo = () => {
    setEditingConta(null)
    setFormData({
      name: '',
      description: '',
      account_type: '',
      bank_id: '',
      agency: '',
      account_number: ''
    })
    setShowModal(true)
  }

  const abrirModalEditar = (conta: Conta) => {
    setEditingConta(conta)
    setFormData({
      name: conta.name || '',
      description: conta.description || '',
      account_type: conta.account_type || '',
      bank_id: conta.bank_id?.toString() || '',
      agency: conta.agency?.toString() || '',
      account_number: conta.account_number?.toString() || ''
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingConta(null)
    setFormData({
      name: '',
      description: '',
      account_type: '',
      bank_id: '',
      agency: '',
      account_number: ''
    })
  }

  const getAccountTypeLabel = (type?: string) => {
    if (!type) return '-'
    const types: { [key: string]: string } = {
      'corrente': 'Conta Corrente',
      'poupanca': 'Poupança',
      'investimento': 'Investimento'
    }
    return types[type] || type
  }

  // Formatar agência com máscara xxxxx-x (5 dígitos + 1 verificador)
  const formatAgency = (agency?: string | number) => {
    if (!agency) return '-'
    const agencyStr = agency.toString().padStart(6, '0')  // Padding para 6 dígitos (5+1)
    const lastDigit = agencyStr.slice(-1)
    const firstPart = agencyStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Máscara de agência para input (sem padding, só insere o traço antes do último dígito)
  const maskAgencyInput = (raw: string) => {
    if (raw.length <= 1) return raw
    return `${raw.slice(0, -1)}-${raw.slice(-1)}`
  }

  // Formatar número da conta com máscara xxxxxxxxx-x (9 dígitos + 1 verificador)
  const formatAccount = (accountNumber?: string | number) => {
    if (!accountNumber) return '-'
    const accountStr = accountNumber.toString().padStart(10, '0')  // Padding para 10 dígitos (9+1)
    const lastDigit = accountStr.slice(-1)
    const firstPart = accountStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Máscara de conta para input (sem padding, só insere o traço antes do último dígito)
  const maskAccountInput = (raw: string) => {
    if (raw.length <= 1) return raw
    return `${raw.slice(0, -1)}-${raw.slice(-1)}`
  }

  const contasAtivas = contas.filter((c) => c.active)
  const contasInativas = contas.filter((c) => !c.active)
  const contasFiltradas = statusFilter === 'active'
    ? contasAtivas
    : statusFilter === 'inactive'
      ? contasInativas
      : contas

  const handleToggleActive = (conta: Conta) => {
    if (conta.active) handleInativar(conta.id)
    else handleReativar(conta.id)
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Landmark className="w-8 h-8" />}
              title="Gerenciar Contas"
              subtitle="Cadastre e gerencie suas contas bancárias"
              actions={<CadastroListCreateButton label="Nova Conta" onClick={abrirModalNovo} />}
            />
          }
          contentOverflow="auto"
          tabs={
            contas.length > 0 ? (
              <CadastroListPageTabs
                tabs={[
                  { key: 'all', label: 'Todas', count: contas.length },
                  { key: 'active', label: 'Ativas', count: contasAtivas.length },
                  { key: 'inactive', label: 'Inativas', count: contasInativas.length },
                ]}
                active={statusFilter}
                onChange={setStatusFilter}
              />
            ) : undefined
          }
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando contas…" />
          ) : contas.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Building2 size={32} className="text-gray-400" />}
              title="Nenhuma conta cadastrada"
              description="Comece adicionando sua primeira conta bancária"
              action={<CadastroListCreateButton label="Adicionar Conta" onClick={abrirModalNovo} />}
            />
          ) : contasFiltradas.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Building2 size={32} className="text-gray-400" />}
              title={statusFilter === 'inactive' ? 'Nenhuma conta inativa' : 'Nenhuma conta ativa'}
              description="Não há contas neste filtro."
            />
          ) : (
            <ListPageTable
              colsRest={<ListTableSpacerCol />}
              head={
                <tr>
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Nome" className="w-[16%]" />
                  <ListTableStaticHeader label="Banco" className="w-[18%]" />
                  <ListTableStaticHeader label="Descrição" className="w-[16%]" />
                  <ListTableStaticHeader label="Agência" />
                  <ListTableStaticHeader label="Conta" />
                  <ListTableStaticHeader label="Tipo" />
                  <ListTableStaticHeader label="Atualização" />
                  <ListTableStaticHeader label="Status" />
                  <ListTableStaticHeader label="Ações" className="w-[8%]" />
                </tr>
              }
            >
              {contasFiltradas.map((conta, index) => {
                const typeKey = (conta.account_type === 'corrente' || conta.account_type === 'poupanca' || conta.account_type === 'investimento')
                  ? conta.account_type
                  : undefined
                return (
                  <tr
                    key={conta.id}
                    className={`${listPageTableRowHoverCls} ${!conta.active ? listPageTableRowInactiveCls : ''}`}
                  >
                    <ListTableIndexCell index={index + 1} />
                    <ListTableSpacerCell />
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-shrink-0 rounded-md p-1.5 shadow-sm" style={{ background: 'var(--gradient-1-2)' }}>
                          <Landmark size={15} style={{ color: 'var(--on-gradient-1-2)' }} />
                        </div>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{conta.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {conta.bank ? `${conta.bank.code} — ${conta.bank.name}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">{conta.description || '—'}</td>
                    <td className="px-3 py-3 text-sm tabular-nums text-gray-600 dark:text-gray-400">{formatAgency(conta.agency)}</td>
                    <td className="px-3 py-3 text-sm tabular-nums text-gray-600 dark:text-gray-400">{formatAccount(conta.account_number)}</td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={badgeVariantForColumnRole('classificationPrimary')}
                        tone={typeKey ? ACCOUNT_TYPE_TONE[typeKey] : 'neutral'}
                        label={getAccountTypeLabel(conta.account_type)}
                      />
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {conta.last_updated_at
                        ? new Date(conta.last_updated_at).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <StatusSwitch
                        checked={conta.active}
                        onChange={() => handleToggleActive(conta)}
                        size="sm"
                        labelOn="Ativa"
                        labelOff="Inativa"
                        showLabel
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => abrirModalEditar(conta)} className={cadastroRowIconBtnCls} title="Editar">
                          <Edit2 size={15} />
                        </button>
                        <button type="button" onClick={() => handleDelete(conta.id)} className={cadastroRowIconDangerCls} title="Excluir">
                          <Trash2 size={15} />
                        </button>
                      </div>
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
              isEdit={!!editingConta}
              title={editingConta ? 'Editar Conta' : 'Nova Conta'}
              subtitle="Dados bancários da conta nesta workspace"
              onClose={fecharModal}
            />
            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
              id="conta-form"
            >
              <CadastroModalBody>
                <CadastroFormSection title="Identificação" icon={<Landmark size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className="block">
                        <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: Conta Itaú Principal"
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block">
                        <CadastroFieldLabel required>Banco</CadastroFieldLabel>
                        <select
                          value={formData.bank_id}
                          onChange={(e) => setFormData({ ...formData, bank_id: e.target.value })}
                          required
                          className={`${cadastroFieldCls} mt-0.5`}
                        >
                          <option value="">Selecione um banco...</option>
                          {[...bancos]
                            .sort((a, b) => parseInt(a.code) - parseInt(b.code))
                            .map((banco) => (
                              <option key={banco.id} value={banco.id}>
                                {banco.code} - {banco.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block">
                        <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                        <input
                          type="text"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: Conta corrente principal"
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow cols={2}>
                      <label className="block">
                        <CadastroFieldLabel>Tipo de Conta</CadastroFieldLabel>
                        <select
                          value={formData.account_type}
                          onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                          className={`${cadastroFieldCls} mt-0.5`}
                        >
                          <option value="">Selecione...</option>
                          <option value="corrente">Conta Corrente</option>
                          <option value="poupanca">Poupança</option>
                          <option value="investimento">Investimento</option>
                        </select>
                      </label>
                      <label className="block">
                        <CadastroFieldLabel>Agência</CadastroFieldLabel>
                        <input
                          type="text"
                          value={maskAgencyInput(formData.agency)}
                          onChange={(e) => {
                            const onlyNumbers = e.target.value.replace(/\D/g, '').slice(0, 6)
                            setFormData({ ...formData, agency: onlyNumbers })
                          }}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: 12345-6"
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block">
                        <CadastroFieldLabel>Número da Conta</CadastroFieldLabel>
                        <input
                          type="text"
                          value={maskAccountInput(formData.account_number)}
                          onChange={(e) => {
                            const onlyNumbers = e.target.value.replace(/\D/g, '').slice(0, 10)
                            setFormData({ ...formData, account_number: onlyNumbers })
                          }}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: 304654-7"
                        />
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={fecharModal}
                onSave={() => {
                  const form = document.getElementById('conta-form') as HTMLFormElement | null
                  form?.requestSubmit()
                }}
                saveLabel={editingConta ? 'Atualizar' : 'Criar'}
              />
            </form>
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

export default ContasPage

