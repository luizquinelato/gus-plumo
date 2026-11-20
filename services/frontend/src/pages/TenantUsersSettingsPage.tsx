import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { ArrowUp, Edit2, Eye, EyeOff, Trash2, UserCog, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import Badge from '../components/Badge'
import StatusSwitch from '../components/StatusSwitch'
import FloatingFooterBar from '../components/FloatingFooterBar'
import { usePageWriteAllowed, WriteGate } from '../contexts/PageMutationContext'
import {
  CadastroListCreateButton,
  CadastroRowMutations,
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
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
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
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { selectionHeaderState } from '../utils/listTableSelection'
import { useConfirm } from '../hooks/useConfirm'

interface TenantUser {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  is_admin: boolean
  active: boolean
  last_login_at: string | null
  created_at: string
}

type UserRole = 'admin' | 'user'

type UserFormState = {
  email: string
  password: string
  confirm_password: string
  first_name: string
  last_name: string
  role: UserRole
}

const usersTableCols = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </>
)

function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayName(user: TenantUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return name || '—'
}

const emptyForm: UserFormState = {
  email: '',
  password: '',
  confirm_password: '',
  first_name: '',
  last_name: '',
  role: 'user',
}

export default function TenantUsersSettingsPage() {
  const canWrite = usePageWriteAllowed()
  const [users, setUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyForm)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { showConfirm, ConfirmComponent } = useConfirm()
  const [toast, setToast] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'warning'
  }>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await axios.get<TenantUser[]>('/api/users/tenant')
      setUsers(data)
    } catch (error) {
      console.error(error)
      showToast('Não foi possível carregar os usuários.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const usersActive = useMemo(() => users.filter((u) => u.active), [users])
  const usersInactive = useMemo(() => users.filter((u) => !u.active), [users])

  const filteredUsers = useMemo(() => {
    if (statusFilter === 'active') return usersActive
    if (statusFilter === 'inactive') return usersInactive
    return users
  }, [users, usersActive, usersInactive, statusFilter])

  const visibleUserIds = useMemo(() => filteredUsers.map((u) => u.id), [filteredUsers])

  const globalHeaderState = useMemo(
    () => selectionHeaderState(visibleUserIds, selectedUserIds),
    [visibleUserIds, selectedUserIds],
  )

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
  }, [loading, users.length, statusFilter])

  useEffect(() => {
    const visible = new Set(visibleUserIds)
    setSelectedUserIds((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleUserIds])

  const toggleGlobalSelection = useCallback(() => {
    const any = visibleUserIds.some((id) => selectedUserIds.has(id))
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (any) visibleUserIds.forEach((id) => next.delete(id))
      else visibleUserIds.forEach((id) => next.add(id))
      return next
    })
  }, [visibleUserIds, selectedUserIds])

  const toggleUserSelection = useCallback((userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }, [])

  const clearBulkSelection = useCallback(() => setSelectedUserIds(new Set()), [])

  useEffect(() => {
    if (!showModal) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharModal()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          const el = document.getElementById('tenant-user-form') as HTMLFormElement | null
          el?.requestSubmit()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showModal])

  const fecharModal = () => {
    if (saving) return
    setShowModal(false)
    setEditingUser(null)
    setForm(emptyForm)
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const openCreateModal = () => {
    setEditingUser(null)
    setForm(emptyForm)
    setShowPassword(false)
    setShowConfirmPassword(false)
    setShowModal(true)
  }

  const openEditModal = (user: TenantUser) => {
    setEditingUser(user)
    setForm({
      email: user.email,
      password: '',
      confirm_password: '',
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      role: user.is_admin ? 'admin' : 'user',
    })
    setShowPassword(false)
    setShowConfirmPassword(false)
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const changingPassword = Boolean(form.password || form.confirm_password)
    if (!editingUser) {
      if (form.password.length < 8) {
        showToast('A senha deve ter pelo menos 8 caracteres.', 'warning')
        return
      }
      if (form.password !== form.confirm_password) {
        showToast('Senha e confirmação não coincidem.', 'warning')
        return
      }
    } else if (changingPassword) {
      if (!form.password || !form.confirm_password) {
        showToast('Preencha a nova senha e a confirmação.', 'warning')
        return
      }
      if (form.password.length < 8) {
        showToast('A nova senha deve ter pelo menos 8 caracteres.', 'warning')
        return
      }
      if (form.password !== form.confirm_password) {
        showToast('Senha e confirmação não coincidem.', 'warning')
        return
      }
    }

    setSaving(true)
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          email: form.email.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || null,
          role: form.role,
        }
        if (form.password) payload.password = form.password
        await axios.patch(`/api/users/tenant/${editingUser.id}`, payload)
        showToast('Usuário atualizado com sucesso.', 'success')
      } else {
        await axios.post('/api/users/tenant', {
          email: form.email.trim(),
          password: form.password,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || null,
          role: form.role,
        })
        showToast('Usuário cadastrado com sucesso.', 'success')
      }
      fecharModal()
      await loadUsers()
    } catch (error: unknown) {
      const detail =
        axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
          ? error.response.data.detail
          : editingUser
            ? 'Erro ao atualizar usuário.'
            : 'Erro ao cadastrar usuário.'
      showToast(detail, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (user: TenantUser) => {
    setTogglingId(user.id)
    try {
      const { data } = await axios.patch<TenantUser>(
        `/api/users/tenant/${user.id}/active`,
        null,
        { params: { active: !user.active } },
      )
      setUsers((prev) => prev.map((u) => (u.id === data.id ? data : u)))
      showToast(data.active ? 'Usuário reativado.' : 'Usuário inativado.', 'success')
    } catch (error: unknown) {
      const detail =
        axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
          ? error.response.data.detail
          : 'Não foi possível alterar o status.'
      showToast(detail, 'error')
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = (user: TenantUser) => {
    showConfirm(
      'Deletar permanentemente',
      `⚠️ Excluir permanentemente o usuário ${user.email}?\n\nEsta ação é irreversível.`,
      async () => {
        try {
          await axios.delete(`/api/users/tenant/${user.id}`)
          await loadUsers()
          setSelectedUserIds((prev) => {
            const next = new Set(prev)
            next.delete(user.id)
            return next
          })
          showToast('Usuário excluído permanentemente.', 'success')
        } catch (error: unknown) {
          const detail =
            axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
              ? error.response.data.detail
              : 'Erro ao excluir usuário.'
          showToast(detail, 'error')
        }
      },
      'Deletar permanentemente',
      'Cancelar',
    )
  }

  const handleBulkDelete = () => {
    const ids = [...selectedUserIds]
    if (ids.length === 0) return
    showConfirm(
      'Deletar usuários',
      `⚠️ Excluir permanentemente ${ids.length} usuário(s)?\n\nEsta ação é irreversível.`,
      async () => {
        setBulkDeleting(true)
        try {
          const { data } = await axios.post<{ deleted: number; skipped: number }>(
            '/api/users/tenant/bulk-delete',
            { ids },
          )
          clearBulkSelection()
          await loadUsers()
          const msg =
            data.skipped > 0
              ? `${data.deleted} usuário(s) excluído(s); ${data.skipped} ignorado(s).`
              : 'Usuários excluídos com sucesso.'
          showToast(msg, data.deleted > 0 ? 'success' : 'warning')
        } catch (error: unknown) {
          const detail =
            axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
              ? error.response.data.detail
              : 'Não foi possível excluir todos os usuários selecionados.'
          showToast(detail, 'error')
        } finally {
          setBulkDeleting(false)
        }
      },
      'Deletar permanentemente',
      'Cancelar',
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <ConfirmComponent />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<UserCog className="h-8 w-8" />}
              title="Usuários"
              subtitle="Cadastre e gerencie os usuários com acesso à plataforma"
              actions={
                <CadastroListCreateButton label="Novo usuário" onClick={openCreateModal} />
              }
            />
          }
          contentOverflow="auto"
          tabs={
            users.length > 0 ? (
              <CadastroListPageTabs
                tabs={[
                  { key: 'all', label: 'Todos', count: users.length },
                  { key: 'active', label: 'Ativos', count: usersActive.length },
                  { key: 'inactive', label: 'Inativos', count: usersInactive.length },
                ]}
                active={statusFilter}
                onChange={setStatusFilter}
              />
            ) : undefined
          }
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando usuários…" />
          ) : users.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<UserCog size={32} className="text-gray-400" />}
              title="Nenhum usuário cadastrado"
              description="Adicione o primeiro usuário com o botão Novo usuário"
            />
          ) : filteredUsers.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<UserCog size={32} className="text-gray-400" />}
              title={statusFilter === 'inactive' ? 'Nenhum usuário inativo' : 'Nenhum usuário ativo'}
              description="Não há usuários neste filtro."
            />
          ) : (
            <ListPageTable
              leadingMode="bulk"
              colsRest={usersTableCols}
              head={
                <tr>
                  <ListTableCheckboxHeader state={globalHeaderState} onToggle={toggleGlobalSelection} />
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Nome" />
                  <ListTableStaticHeader label="E-mail" />
                  <ListTableStaticHeader label="Tipo" />
                  <ListTableStaticHeader label="Último login" />
                  <ListTableStaticHeader label="Status" />
                  <ListTableStaticHeader label="Ações" />
                </tr>
              }
            >
              {filteredUsers.map((user, index) => {
                const selected = selectedUserIds.has(user.id)
                return (
                  <tr
                    key={user.id}
                    className={`${listPageTableRowHoverCls} ${!user.active ? listPageTableRowInactiveCls : ''}`}
                  >
                    <ListTableCheckboxCell
                      checked={selected}
                      onToggle={() => toggleUserSelection(user.id)}
                    />
                    <ListTableIndexCell index={index + 1} />
                    <ListTableSpacerCell />
                    <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">{displayName(user)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{user.email}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={badgeVariantForColumnRole('classificationPrimary')}
                        tone={user.is_admin ? 'brand1' : 'neutral'}
                        label={user.is_admin ? 'Administrador' : 'Usuário'}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatDateTimeBr(user.last_login_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusSwitch
                        checked={user.active}
                        disabled={togglingId === user.id}
                        onChange={() => void handleToggleActive(user)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <CadastroRowMutations>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            className={cadastroRowIconBtnCls}
                            title="Editar"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(user)}
                            className={cadastroRowIconDangerCls}
                            title="Excluir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </CadastroRowMutations>
                    </td>
                  </tr>
                )
              })}
            </ListPageTable>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {canWrite && selectedUserIds.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedUserIds.size}{' '}
                {selectedUserIds.size === 1 ? 'usuário selecionado' : 'usuários selecionados'}
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

      {showBackToTop && selectedUserIds.size === 0 && (
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
        <CadastroModalShell maxWidth="max-w-3xl">
          <CadastroModalHeader
            isEdit={!!editingUser}
            title={editingUser ? 'Editar usuário' : 'Novo usuário'}
            subtitle={
              editingUser
                ? 'Atualize identificação, senha ou perfil. Permissões vêm de Configurações → Acessos.'
                : 'Escolha o perfil (Usuário ou Administrador). Páginas e permissões são definidas em Configurações → Acessos.'
            }
            onClose={fecharModal}
          />
          <form id="tenant-user-form" onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <CadastroModalBody>
              <CadastroFormSection title="Identificação" icon={<UserCog size={14} />}>
                <CadastroModalFieldsGrid className="md:grid-cols-2">
                  <CadastroModalFieldsRow className="md:col-span-2 md:grid md:grid-cols-2 md:gap-4">
                    <label className="block">
                      <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                      <input
                        type="text"
                        value={form.first_name}
                        onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Maria"
                        autoComplete="given-name"
                      />
                    </label>
                    <label className="block">
                      <CadastroFieldLabel>Sobrenome</CadastroFieldLabel>
                      <input
                        type="text"
                        value={form.last_name}
                        onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Silva"
                        autoComplete="family-name"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow className="md:col-span-2">
                    <label className="block md:col-span-2">
                      <CadastroFieldLabel required>E-mail</CadastroFieldLabel>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="usuario@exemplo.com"
                        autoComplete="off"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Acesso" icon={<Eye size={14} />}>
                <CadastroModalFieldsGrid className="lg:grid-cols-2 lg:gap-6">
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block">
                      <CadastroFieldLabel required={!editingUser}>
                        {editingUser ? 'Nova senha (opcional)' : 'Senha inicial'}
                      </CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          required={!editingUser}
                          minLength={editingUser ? undefined : 8}
                          className={`${cadastroFieldCls} pr-10`}
                          placeholder={editingUser ? 'Deixe vazio para manter' : 'Mínimo 8 caracteres'}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          onClick={() => setShowPassword((v) => !v)}
                          tabIndex={-1}
                          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </label>
                    <label className="block">
                      <CadastroFieldLabel required={!editingUser}>
                        {editingUser ? 'Confirmar nova senha' : 'Confirmar senha'}
                      </CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={form.confirm_password}
                          onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                          required={!editingUser}
                          className={`${cadastroFieldCls} pr-10`}
                          placeholder={editingUser ? 'Repita a nova senha' : 'Repita a senha'}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                          tabIndex={-1}
                          aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                        >
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                  <div>
                    <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Perfil</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                        <input
                          type="radio"
                          name="user-role"
                          checked={form.role === 'user'}
                          onChange={() => setForm({ ...form, role: 'user' })}
                          className="mt-1 h-4 w-4 border-gray-300 text-[var(--color-1)] focus:ring-[var(--color-1)]"
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-900 dark:text-white">Usuário</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            Padrão. Herda permissões e páginas definidas em Configurações → Acessos.
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                        <input
                          type="radio"
                          name="user-role"
                          checked={form.role === 'admin'}
                          onChange={() => setForm({ ...form, role: 'admin' })}
                          className="mt-1 h-4 w-4 border-gray-300 text-[var(--color-1)] focus:ring-[var(--color-1)]"
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-900 dark:text-white">
                            Administrador
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            Acesso total; gerencia usuários e acessos do tenant.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={fecharModal}
              closeDisabled={saving}
              onSave={() => {
                const el = document.getElementById('tenant-user-form') as HTMLFormElement | null
                el?.requestSubmit()
              }}
              saving={saving}
              saveLabel={editingUser ? 'Atualizar' : 'Cadastrar'}
              saveTone={editingUser ? 'update' : 'create'}
            />
          </form>
        </CadastroModalShell>
      )}

      {toast.show && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast((t) => ({ ...t, show: false }))} />
      )}
    </div>
  )
}