import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { FileText, Save, Shield, UserCog } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageShell,
  CadastroListPageTabs,
} from '../components/CadastroListPageLayout'

type RoleTab = 'admin' | 'user'

interface PageOption {
  page_key: string
  route: string
  label: string
  group_label: string
  sort_order: number
}

type PageGrantState = Record<string, { can_read: boolean; can_write: boolean }>

export default function TenantAccessSettingsPage() {
  const [roleTab, setRoleTab] = useState<RoleTab>('user')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageOptions, setPageOptions] = useState<PageOption[]>([])
  const [pageGrants, setPageGrants] = useState<PageGrantState>({})
  const [toast, setToast] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'warning'
  }>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const loadRolePages = useCallback(async (role: RoleTab) => {
    setLoading(true)
    try {
      const { data } = await axios.get<{
        page_options: PageOption[]
        page_grants: { page_key: string; can_read: boolean; can_write: boolean }[]
        configurable: boolean
      }>(`/api/access/roles/${role}/pages`)
      setPageOptions(data.page_options)
      if (role === 'user') {
        const pg: PageGrantState = {}
        for (const g of data.page_grants) {
          pg[g.page_key] = { can_read: g.can_read, can_write: g.can_write }
        }
        setPageGrants(pg)
      }
    } catch {
      showToast('Não foi possível carregar as configurações.', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRolePages(roleTab)
  }, [roleTab, loadRolePages])

  const pagesByGroup = useMemo(() => {
    const map = new Map<string, PageOption[]>()
    for (const p of pageOptions) {
      const list = map.get(p.group_label) ?? []
      list.push(p)
      map.set(p.group_label, list)
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    }
    return [...map.entries()].sort((a, b) => (a[1][0]?.sort_order ?? 0) - (b[1][0]?.sort_order ?? 0))
  }, [pageOptions])

  const setPageRead = (pageKey: string, checked: boolean) => {
    setPageGrants((prev) => {
      const cur = prev[pageKey] ?? { can_read: false, can_write: false }
      return {
        ...prev,
        [pageKey]: { can_read: checked, can_write: checked ? cur.can_write : false },
      }
    })
  }

  const setPageWrite = (pageKey: string, checked: boolean) => {
    setPageGrants((prev) => {
      const cur = prev[pageKey] ?? { can_read: false, can_write: false }
      return {
        ...prev,
        [pageKey]: { can_read: checked ? true : cur.can_read, can_write: checked },
      }
    })
  }

  const saveUserPages = async () => {
    setSaving(true)
    try {
      const page_grants = Object.entries(pageGrants)
        .filter(([, g]) => g.can_read)
        .map(([page_key, g]) => ({
          page_key,
          can_read: g.can_read,
          can_write: g.can_write,
        }))
      await axios.put('/api/access/roles/user/pages', { page_grants })
      showToast('Páginas do perfil Usuário salvas.', 'success')
    } catch {
      showToast('Erro ao salvar.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Shield className="h-8 w-8" />}
              title="Acessos"
              subtitle="Defina leitura e escrita por página para cada perfil. Quem você cadastrar como Usuário herda o perfil Usuário; Administrador tem acesso total."
            />
          }
          tabs={
            <CadastroListPageTabs
              tabs={[
                { key: 'admin', label: 'Administrador', icon: <Shield size={16} /> },
                { key: 'user', label: 'Usuário', icon: <UserCog size={16} /> },
              ]}
              active={roleTab}
              onChange={(key) => setRoleTab(key as RoleTab)}
            />
          }
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando…" />
          ) : roleTab === 'admin' ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-600 dark:bg-gray-800">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                O perfil <strong>Administrador</strong> tem <strong>leitura e escrita</strong> em todas as páginas
                do sistema (incluindo configurações, usuários e acessos). Não é necessário configurar permissões
                adicionais.
              </p>
              <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                {pageOptions.length} páginas no catálogo — todas liberadas para este perfil.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Marque as páginas que usuários com perfil <strong>Usuário</strong> podem acessar. Escrita inclui
                alterações nas telas correspondentes.
              </p>
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
                <div className="grid gap-6 xl:grid-cols-2">
                  {pagesByGroup.map(([group, pages]) => (
                    <div key={group}>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {group}
                      </p>
                      <div className="space-y-1">
                        {pages.map((page) => {
                          const grant = pageGrants[page.page_key] ?? {
                            can_read: false,
                            can_write: false,
                          }
                          return (
                            <div
                              key={page.page_key}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            >
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{page.label}</span>
                              <div className="flex items-center gap-4 text-xs">
                                <label className="flex cursor-pointer items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={grant.can_read}
                                    onChange={(e) => setPageRead(page.page_key, e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-[var(--color-1)]"
                                  />
                                  Leitura
                                </label>
                                <label className="flex cursor-pointer items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={grant.can_write}
                                    onChange={(e) => setPageWrite(page.page_key, e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-[var(--color-1)]"
                                  />
                                  Escrita
                                </label>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveUserPages()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-1)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? 'Salvando…' : 'Salvar perfil Usuário'}
                </button>
              </div>
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {toast.show && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast((t) => ({ ...t, show: false }))} />
      )}
    </div>
  )
}