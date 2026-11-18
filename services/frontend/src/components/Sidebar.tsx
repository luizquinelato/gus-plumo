import { Home, Palette, TrendingUp, Sun, Moon, CreditCard, LogOut, Tags, ClipboardCheck, FolderTree, Settings, ChevronRight, ChevronLeft, Building2, Users, User, FileText, RefreshCw, Copy, Scale, Layers, Wallet, Feather, Camera, FolderOpen, Link2, Landmark, Handshake, Activity, FileUp, CalendarDays } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useSidebar } from '../contexts/SidebarContext'
import { useDeviceMode } from '../contexts/DeviceModeContext'
import MobileTopBar from './MobileTopBar'
import MobileBottomNav from './MobileBottomNav'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import SidebarNavGroup from './SidebarNavGroup'
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
function getAvatarUrl(path: string | undefined): string | null {
  if (!path) return null
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`
}

interface SelectedAccount {
  id: number
  name: string
  bank?: {
    id: number
    code: string
    name: string
    full_name?: string
  }
  agency?: string
  account_number?: number
}

type NavGroupId = 'cadastro' | 'relatorios' | 'fechamentos'

const CADASTRO_ROUTES = [
  '/configuracoes/cartoes',
  '/configuracoes/contas',
  '/configuracoes/compartilhamentos',
  '/configuracoes/tags-subtags',
  '/templates',
  '/mappings',
]

const FECHAMENTOS_ROUTES = ['/fechamentos']

const cadastroSubmenu = [
  { icon: CreditCard, label: 'Cartões', path: '/configuracoes/cartoes' },
  { icon: Users, label: 'Compartilhamentos', path: '/configuracoes/compartilhamentos' },
  { icon: Building2, label: 'Contas', path: '/configuracoes/contas' },
  { icon: FolderTree, label: 'Mapeamentos', path: '/mappings' },
  { icon: Tags, label: 'Tags & Subtags', path: '/configuracoes/tags-subtags' },
  { icon: FileText, label: 'Templates', path: '/templates' },
]

const relatoriosSubmenu = [
  { icon: FileText, label: 'Extrato', path: '/relatorios/extrato' },
  { icon: CreditCard, label: 'Faturas', path: '/relatorios/faturas' },
  { icon: Layers, label: 'Grupo', path: '/relatorios/grupo' },
  { icon: CalendarDays, label: 'Projeção Mensal', path: '/relatorios/projecao-mensal' },
  { icon: Wallet, label: 'Saldo Parcelado', path: '/relatorios/saldo-parcelado' },
  { icon: Activity, label: 'Saúde Financeira', path: '/relatorios/saude' },
]

const fechamentosSubmenu = [
  { icon: Scale, label: 'Compartilhado', path: '/fechamentos/compartilhado' },
  { icon: Landmark, label: 'Conta', path: '/fechamentos/conta' },
  { icon: Link2, label: 'Reconciliação de Faturas', path: '/fechamentos/faturas' },
]

const topLevelMenuItems = [
  { icon: Home, label: 'Home', path: '/' },
]

const importMenuItems = [
  { icon: FileUp, label: 'Importar', path: '/importar' },
]

const afterFechamentosMenuItems = [
  { icon: ClipboardCheck, label: 'Curadoria', path: '/curadoria' },
  { icon: Wallet, label: 'Empréstimos', path: '/emprestimos' },
  { icon: FileText, label: 'Informes', path: '/informes' },
  { icon: Handshake, label: 'Consórcios', path: '/consorcios' },
]

function activeNavGroupId(pathname: string): NavGroupId | null {
  if (CADASTRO_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return 'cadastro'
  }
  if (pathname.startsWith('/relatorios')) {
    return 'relatorios'
  }
  if (pathname.startsWith('/fechamentos')) {
    return 'fechamentos'
  }
  return null
}

const Sidebar = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { user, logout, updateUser } = useAuth()
  const { collapsed, toggleCollapsed, mobileMenuOpen, closeMobileMenu } = useSidebar()
  const { isMobile } = useDeviceMode()
  const menuCollapsed = isMobile ? false : collapsed
  const showPortalNav = !isMobile
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<SelectedAccount | null>(null)
  const [avatarHov, setAvatarHov] = useState(false)
  const [logoHover, setLogoHover] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Refs para os flyout menus (botões no sidebar)
  const settingsMenuRef = useRef<HTMLLIElement>(null)

  // Refs para os flyout popups (renderizados via Portal)
  const settingsPopupRef = useRef<HTMLDivElement>(null)
  const profilePopupRef = useRef<HTMLDivElement>(null)

  // Estados dos submenus
  const [openGroups, setOpenGroups] = useState<Set<NavGroupId>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Busca dados da conta selecionada
  useEffect(() => {
    const fetchSelectedAccount = async () => {
      if (user?.account_id) {
        // 1. Carrega dados do localStorage imediatamente (evita flash)
        const cachedAccount = localStorage.getItem(`account_${user.account_id}`)
        if (cachedAccount) {
          try {
            setSelectedAccount(JSON.parse(cachedAccount))
          } catch (error) {
            console.error('Erro ao parsear conta do cache:', error)
          }
        }

        // 2. Busca dados atualizados da API em background
        try {
          const response = await axios.get(`/api/accounts/${user.account_id}`)
          setSelectedAccount(response.data)
          // 3. Atualiza cache
          localStorage.setItem(`account_${user.account_id}`, JSON.stringify(response.data))
        } catch (error) {
          console.error('Erro ao buscar dados da conta:', error)
        }
      } else {
        setSelectedAccount(null)
      }
    }

    fetchSelectedAccount()
  }, [user?.account_id])

  // Fecha todos os menus flyout quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      // Fecha menu de perfil (verifica botão E popup)
      if (
        profileMenuRef.current && !profileMenuRef.current.contains(target) &&
        (!profilePopupRef.current || !profilePopupRef.current.contains(target))
      ) {
        setIsProfileMenuOpen(false)
      }
      // Fecha flyout de configurações (verifica botão E popup)
      if (
        settingsMenuRef.current && !settingsMenuRef.current.contains(target) &&
        (!settingsPopupRef.current || !settingsPopupRef.current.contains(target))
      ) {
        setSettingsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const activeGroupId = useMemo(() => activeNavGroupId(location.pathname), [location.pathname])

  useEffect(() => {
    if (isMobile) {
      closeMobileMenu()
    }
  }, [location.pathname, isMobile, closeMobileMenu])

  useEffect(() => {
    if (isMobile && mobileMenuOpen) {
      setOpenGroups(new Set(['relatorios']))
    }
  }, [isMobile, mobileMenuOpen])

  useEffect(() => {
    if (collapsed) {
      setOpenGroups(new Set())
      return
    }
    setOpenGroups(activeGroupId ? new Set([activeGroupId]) : new Set())
  }, [activeGroupId, collapsed, location.pathname])

  const toggleNavGroup = useCallback((groupId: NavGroupId) => {
    setOpenGroups((prev) => {
      if (prev.has(groupId)) {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      }
      if (collapsed) return new Set([groupId])
      const next = new Set<NavGroupId>([groupId])
      if (activeGroupId && activeGroupId !== groupId) next.add(activeGroupId)
      return next
    })
  }, [activeGroupId, collapsed])

  const closeNavGroup = useCallback((groupId: NavGroupId) => {
    setOpenGroups((prev) => {
      if (!prev.has(groupId)) return prev
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }, [])

  const handleSwitchAccount = () => {
    setIsProfileMenuOpen(false)
    // Usar window.location.href para limpar histórico
    window.location.href = '/select-account'
  }

  const handleLogout = () => {
    setIsProfileMenuOpen(false)
    logout()
    navigate('/login')
  }

  const initials = user?.nome
    ? user.nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('')
    : (user?.email?.charAt(0)?.toUpperCase() ?? 'U')

  const handleAvatarUpload = async (file: File) => {
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await axios.post('/api/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      updateUser({ avatar_url: data.avatar_url })
    } catch (error) {
      console.error('Erro ao fazer upload do avatar:', error)
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Menu de configurações (separado, apenas Cores e Copiar)
  const settingsMenuItem = {
    icon: Settings,
    label: 'Configurações',
    path: '/configuracoes',
    submenu: [
      { icon: Copy, label: 'Copiar Configurações', path: '/configuracoes/copy-settings' },
      { icon: Palette, label: 'Cores', path: '/configuracoes/cores' },
    ]
  }

  const headerBorderColor = theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.12)'
  const collapseMutedColor = theme === 'dark' ? '#94A3B8' : 'rgba(255,255,255,0.65)'

  const renderCollapseButton = (options?: { title?: string }) => (
    <button
      type="button"
      onClick={toggleCollapsed}
      title={options?.title ?? (collapsed ? 'Expandir menu' : 'Recolher menu')}
      className="flex items-center justify-center flex-shrink-0 transition-all duration-150"
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)',
        border: `1px solid ${headerBorderColor}`,
        color: collapseMutedColor,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)'
        e.currentTarget.style.borderColor = 'var(--color-1)'
        e.currentTarget.style.color = 'var(--color-1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)'
        e.currentTarget.style.borderColor = headerBorderColor
        e.currentTarget.style.color = collapseMutedColor
      }}
    >
      {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
    </button>
  )

  return (
    <>
      {isMobile && <MobileTopBar />}
      {isMobile && <MobileBottomNav />}
      {isMobile && mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[55] bg-black/50 md:hidden"
          aria-label="Fechar menu"
          onClick={closeMobileMenu}
        />
      )}
    <aside
      className={[
        'bg-gray-900 dark:bg-gray-900 text-white flex flex-col border-r border-gray-700 dark:border-gray-700 overflow-visible transition-all duration-300 ease-in-out flex-shrink-0',
        isMobile
          ? `fixed inset-y-0 left-0 z-[60] w-64 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}`
          : `relative ${menuCollapsed ? 'w-16' : 'w-64'}`,
      ].join(' ')}
      style={{ boxShadow: '2px 0 16px rgba(0,0,0,0.45)' }}
    >
      {/* Logo/Brand + colapso no header (estilo Vigra) */}
      {collapsed ? (
        <div
          className="flex flex-col items-center justify-center flex-shrink-0"
          style={{
            minHeight: 80,
            padding: '12px 0',
            background: 'var(--gradient-1-2)',
            borderBottom: `1px solid ${headerBorderColor}`,
          }}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Expandir menu"
            onMouseEnter={() => setLogoHover(true)}
            onMouseLeave={() => setLogoHover(false)}
            className="relative flex items-center justify-center rounded-lg transition-colors duration-200"
            style={{
              width: 32,
              height: 32,
              background: logoHover ? 'rgba(255,255,255,0.12)' : 'transparent',
            }}
          >
            <div
              className="flex items-center justify-center transition-opacity duration-200"
              style={{ opacity: logoHover ? 0 : 1 }}
            >
              <Feather size={26} style={{ color: 'var(--on-gradient-1-2)' }} />
            </div>
            <span
              className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
              style={{ opacity: logoHover ? 1 : 0, color: 'var(--on-gradient-1-2)' }}
            >
              <ChevronRight size={16} />
            </span>
          </button>
        </div>
      ) : (
        <div
          className="relative flex items-center justify-center flex-shrink-0"
          style={{
            minHeight: 80,
            padding: '10px 36px 12px 10px',
            background: 'var(--gradient-1-2)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.8)',
            borderBottom: `1px solid ${headerBorderColor}`,
          }}
        >
          <div className="absolute top-2 right-2">{renderCollapseButton({ title: 'Recolher menu' })}</div>
          <div className="flex items-center gap-3 min-w-0">
            <Feather size={26} style={{ color: 'var(--on-gradient-1-2)', flexShrink: 0 }} />
            <div className="min-w-0">
              <h1
                className="text-xl font-black tracking-wider flex items-center gap-2 whitespace-nowrap"
                style={{ color: 'var(--on-gradient-1-2)' }}
              >
                PLUMO
                {import.meta.env.MODE === 'dev' && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-400 text-yellow-900 tracking-normal align-middle">
                    DEV
                  </span>
                )}
              </h1>
              <p className="text-xs italic whitespace-nowrap" style={{ color: 'var(--on-gradient-1-2)', opacity: 0.8 }}>
                Finanças leves, vida plena
              </p>
            </div>
          </div>
        </div>
      )}

      {!collapsed && selectedAccount && (
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm leading-tight text-gray-400">
            <Building2 size={14} className="shrink-0" />
            <span className="font-medium text-gray-200">{selectedAccount.name || 'Conta sem nome'}</span>
          </div>
          <div className="ml-5 mt-1 text-sm leading-tight text-gray-500">
            {selectedAccount.bank?.name || 'Banco não informado'}
            {selectedAccount.agency && ` • ${selectedAccount.agency}`}
            {selectedAccount.account_number && ` • ${selectedAccount.account_number}`}
          </div>
        </div>
      )}

      {/* Navigation Menu */}
      <nav className="flex-1 p-2 overflow-y-auto">
        {!collapsed && (
          <p className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Principal
          </p>
        )}
        <ul className="space-y-0.5">
          {topLevelMenuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={`
                    flex items-center gap-3 rounded-lg transition-colors duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                    ${isActive ? '' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                  `}
                  style={isActive ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' } : undefined}
                >
                  <Icon size={20} />
                  {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                </Link>
              </li>
            )
          })}

          {showPortalNav && (
          <SidebarNavGroup
            id="fechamentos"
            icon={Scale}
            label="Fechamentos"
            routes={FECHAMENTOS_ROUTES}
            items={fechamentosSubmenu}
            collapsed={menuCollapsed}
            open={openGroups.has('fechamentos')}
            onToggle={() => toggleNavGroup('fechamentos')}
            onClose={() => closeNavGroup('fechamentos')}
          />
          )}

          {showPortalNav && afterFechamentosMenuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={`
                    flex items-center gap-3 rounded-lg transition-colors duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                    ${isActive ? '' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                  `}
                  style={isActive ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' } : undefined}
                >
                  <Icon size={20} />
                  {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                </Link>
              </li>
            )
          })}

          <SidebarNavGroup
            id="relatorios"
            icon={TrendingUp}
            label="Relatórios"
            routes={['/relatorios']}
            items={relatoriosSubmenu}
            collapsed={menuCollapsed}
            open={openGroups.has('relatorios')}
            onToggle={() => toggleNavGroup('relatorios')}
            onClose={() => closeNavGroup('relatorios')}
          />

          {showPortalNav && (
          <SidebarNavGroup
            id="cadastro"
            icon={FolderOpen}
            label="Cadastro"
            routes={CADASTRO_ROUTES}
            items={cadastroSubmenu}
            collapsed={menuCollapsed}
            open={openGroups.has('cadastro')}
            onToggle={() => toggleNavGroup('cadastro')}
            onClose={() => closeNavGroup('cadastro')}
          />
          )}

          {showPortalNav && (
          <>
          <li className={menuCollapsed ? 'mx-2 my-2 border-t border-gray-700' : 'px-3 pb-1 pt-4'}>
            {!menuCollapsed && (
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Importação
              </p>
            )}
          </li>
          {importMenuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={`
                    flex items-center gap-3 rounded-lg transition-colors duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                    ${isActive ? '' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                  `}
                  style={isActive ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' } : undefined}
                >
                  <Icon size={20} />
                  {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                </Link>
              </li>
            )
          })}
          </>
          )}
        </ul>
      </nav>

      {/* Settings Menu — acima do tema, como no Vigra */}
      {showPortalNav && (
      <div className={`border-t border-gray-800 pt-2 pb-1 ${menuCollapsed ? 'px-2' : 'px-2'}`}>
        <ul>
          {(() => {
            const item = settingsMenuItem
            const Icon = item.icon
            const isSubmenuActive = item.submenu.some(sub => location.pathname === sub.path)
            return (
              <li ref={settingsMenuRef} className="relative">
                <button
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  title={collapsed ? item.label : undefined}
                  className={`
                    w-full flex items-center gap-3 rounded-lg transition-colors duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'}
                    ${isSubmenuActive ? '' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                  `}
                  style={isSubmenuActive ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' } : undefined}
                >
                  <Icon size={20} />
                  {!collapsed && <span className="font-medium flex-1 text-left text-sm">{item.label}</span>}
                  {!collapsed && <ChevronRight size={15} className={`transition-transform duration-200 ${settingsOpen ? 'rotate-90' : ''}`} />}
                </button>

                {settingsOpen && settingsMenuRef?.current && createPortal(
                  <div
                    ref={settingsPopupRef}
                    className="fixed w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden"
                    style={{
                      left: settingsMenuRef.current.getBoundingClientRect().right + 8,
                      top: settingsMenuRef.current.getBoundingClientRect().top,
                      zIndex: 99999
                    }}
                  >
                    {/* Título do submenu */}
                    <div className="px-4 pt-3 pb-2 border-b border-gray-700">
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-1)' }}>
                        {item.label}
                      </p>
                    </div>
                    <div className="py-1.5">
                      {item.submenu.map((subItem) => {
                        const SubIcon = subItem.icon
                        const isSubActive = location.pathname === subItem.path
                        return (
                          <Link
                            key={subItem.path}
                            to={subItem.path}
                            onClick={() => setSettingsOpen(false)}
                            className={`
                              flex items-center gap-3 px-4 py-2 mx-1.5 rounded-lg
                              transition-colors duration-200 text-sm
                              ${isSubActive ? '' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}
                            `}
                            style={isSubActive ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' } : undefined}
                          >
                            <SubIcon size={17} />
                            <span className="font-medium">{subItem.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>,
                  document.body
                )}
              </li>
            )
          })()}
        </ul>
      </div>
      )}

      {/* Theme Toggle — abaixo de Configurações */}
      <div className={`border-t border-gray-800 pt-2 pb-2 ${collapsed ? 'px-2' : 'px-3'}`}>
        {collapsed ? (
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
            className="w-full flex items-center justify-center py-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors duration-200"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        ) : (
          <div
            className="flex rounded-lg p-0.5"
            style={{ background: theme === 'dark' ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.08)' }}
          >
            {([
              { label: 'Claro', Icon: Sun, active: theme === 'light', onClick: () => theme === 'dark' && toggleTheme() },
              { label: 'Escuro', Icon: Moon, active: theme === 'dark', onClick: () => theme === 'light' && toggleTheme() },
            ] as const).map(({ label, Icon, active, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
                style={{
                  background: active ? (theme === 'dark' ? '#2A2D3E' : 'rgba(255,255,255,0.15)') : 'transparent',
                  color: active ? (theme === 'dark' ? '#F1F5F9' : 'white') : (theme === 'dark' ? '#64748b' : 'rgba(255,255,255,0.5)'),
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,.25)' : 'none',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User Profile Section */}
      <div className={`border-t border-gray-800 relative ${collapsed ? 'p-2' : 'p-3'}`} ref={profileMenuRef}>
        {/* Botão de perfil */}
        <button
          onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          title={collapsed ? (user?.nome || 'Perfil') : undefined}
          className={`w-full flex items-center rounded-lg hover:bg-gray-800 transition-colors duration-200 ${collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-2 py-2'}`}
        >
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden"
            style={{ background: 'var(--gradient-2-3)' }}
          >
            {getAvatarUrl(user?.avatar_url) ? (
              <img src={getAvatarUrl(user?.avatar_url)!} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--on-gradient-2-3)' }}>
                <span className="text-sm font-bold">{initials}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left min-w-0">
                <p className="font-medium text-white text-sm truncate">{user?.nome || user?.email || 'Usuário'}</p>
                <p className="text-xs text-gray-400">{user?.is_admin ? 'Administrador' : 'Usuário'}</p>
              </div>
              <ChevronRight size={16} className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>

        {/* Dropdown Menu - Abre para o lado direito usando Portal */}
        {isProfileMenuOpen && profileMenuRef.current && createPortal(
          <div
            ref={profilePopupRef}
            className="fixed w-52 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2"
            style={{
              left: profileMenuRef.current.getBoundingClientRect().right,
              bottom: window.innerHeight - profileMenuRef.current.getBoundingClientRect().bottom,
              zIndex: 99999
            }}
          >
            {/* Header do flyout: avatar + nome + email */}
            <div className="px-4 pt-3 pb-2 border-b border-gray-700">
              <div className="flex items-center gap-3">
                {/* Avatar clicável para upload */}
                <div
                  className="relative w-10 h-10 rounded-full flex-shrink-0 overflow-hidden cursor-pointer"
                  style={{ background: 'var(--gradient-2-3)' }}
                  onClick={() => avatarInputRef.current?.click()}
                  onMouseEnter={() => setAvatarHov(true)}
                  onMouseLeave={() => setAvatarHov(false)}
                  title="Clique para trocar foto"
                >
                  {getAvatarUrl(user?.avatar_url) ? (
                    <img
                      src={getAvatarUrl(user?.avatar_url)!}
                      alt="avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ color: 'var(--on-gradient-2-3)' }}
                    >
                      <span className="text-sm font-bold">{initials}</span>
                    </div>
                  )}
                  {/* Overlay com câmera ao hover */}
                  <div
                    className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
                    style={{
                      background: 'rgba(0,0,0,0.55)',
                      opacity: avatarHov || uploadingAvatar ? 1 : 0,
                    }}
                  >
                    {uploadingAvatar ? (
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Camera size={14} color="white" />
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-white truncate">
                    {user?.nome || user?.email || '—'}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{user?.email || ''}</p>
                </div>
              </div>
            </div>

            {/* Perfil */}
            <button
              onClick={() => { navigate('/profile'); setIsProfileMenuOpen(false) }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200 ${location.pathname === '/profile' ? 'bg-gray-700 text-white' : ''}`}
            >
              <User size={18} />
              <span className="font-medium text-sm">Perfil</span>
            </button>

            {/* Trocar Conta */}
            <button
              onClick={handleSwitchAccount}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
            >
              <RefreshCw size={18} />
              <span className="font-medium text-sm">Trocar Conta</span>
            </button>

            {/* Sair */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:bg-red-600 hover:text-white transition-colors duration-200"
            >
              <LogOut size={18} />
              <span className="font-medium text-sm">Sair</span>
            </button>
          </div>,
          document.body
        )}
      </div>

      {/* Input oculto para upload de avatar */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleAvatarUpload(file)
          e.target.value = ''
        }}
      />
    </aside>
    </>
  )
}

export default Sidebar

