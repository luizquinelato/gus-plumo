import { Home, Palette, TrendingUp, Sun, Moon, CreditCard, LogOut, Tags, ClipboardCheck, FolderTree, Settings, ChevronRight, ChevronLeft, Building2, Users, User, BarChart3, FileText, RefreshCw, Copy, Scale, Layers, Wallet, Feather, Camera } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'

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

const Sidebar = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { user, logout, updateUser } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<SelectedAccount | null>(null)
  const [avatarHov, setAvatarHov] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Refs para os flyout menus (botões no sidebar)
  const settingsMenuRef = useRef<HTMLLIElement>(null)
  const reportsMenuRef = useRef<HTMLLIElement>(null)

  // Refs para os flyout popups (renderizados via Portal)
  const settingsPopupRef = useRef<HTMLDivElement>(null)
  const reportsPopupRef = useRef<HTMLDivElement>(null)
  const profilePopupRef = useRef<HTMLDivElement>(null)

  // Estados dos submenus flyout
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

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
      // Fecha flyout de relatórios (verifica botão E popup)
      if (
        reportsMenuRef.current && !reportsMenuRef.current.contains(target) &&
        (!reportsPopupRef.current || !reportsPopupRef.current.contains(target))
      ) {
        setReportsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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

  // Menus principais: Home primeiro, depois ordenados alfabeticamente
  const mainMenuItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: Scale, label: 'Balanço', path: '/balanco' },
    { icon: CreditCard, label: 'Cartões', path: '/configuracoes/cartoes' },
    { icon: Users, label: 'Compartilhamentos', path: '/configuracoes/compartilhamentos' },
    { icon: Building2, label: 'Contas', path: '/configuracoes/contas' },
    { icon: ClipboardCheck, label: 'Curadoria', path: '/curadoria' },
    { icon: Wallet, label: 'Empréstimos', path: '/emprestimos' },
    { icon: FolderTree, label: 'Mapeamentos', path: '/mappings' },
    {
      icon: TrendingUp,
      label: 'Relatórios',
      path: '/relatorios',
      submenu: [
        { icon: FileText, label: 'Extrato', path: '/relatorios/extrato' },
        { icon: CreditCard, label: 'Faturas', path: '/relatorios/faturas' },
        { icon: Layers, label: 'Grupo', path: '/relatorios/grupo' },
      ]
    },
    { icon: Tags, label: 'Tags & Subtags', path: '/configuracoes/tags-subtags' },
    { icon: FileText, label: 'Templates', path: '/templates' },
  ]

  // Menu de configurações (separado, apenas Cores e Copiar — ordenado alfabeticamente)
  const settingsMenuItem = {
    icon: Settings,
    label: 'Configurações',
    path: '/configuracoes',
    submenu: [
      { icon: Copy, label: 'Copiar Configurações', path: '/configuracoes/copy-settings' },
      { icon: Palette, label: 'Cores', path: '/configuracoes/cores' },
    ]
  }

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-900 dark:bg-gray-900 text-white flex flex-col border-r border-gray-700 dark:border-gray-700 overflow-visible relative transition-all duration-300 ease-in-out flex-shrink-0`}
      style={{ boxShadow: '2px 0 16px rgba(0,0,0,0.45)' }}
    >
      {/* Botão de colapso — centro vertical, borda direita */}
      <div style={{ position: 'absolute', top: '50%', right: -13, transform: 'translateY(-50%)', zIndex: 10 }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          style={{
            width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme === 'dark' ? '#2A2D3E' : '#1f2937',
            border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.2)'}`,
            color: theme === 'dark' ? '#94A3B8' : '#9ca3af',
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Logo/Brand */}
      <div
        className="flex items-center flex-shrink-0"
        style={{
          background: 'var(--gradient-1-2)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.8)',
          padding: collapsed ? '14px 0' : '14px 20px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? 0 : 12,
          minHeight: 80,
          transition: 'padding 0.3s ease, gap 0.3s ease',
        }}
      >
        <Feather size={26} style={{ color: 'var(--on-gradient-1-2)', flexShrink: 0 }} />
        <div
          className="min-w-0 overflow-hidden"
          style={{
            opacity: collapsed ? 0 : 1,
            maxWidth: collapsed ? 0 : 200,
            pointerEvents: collapsed ? 'none' : 'auto',
            /* ao expandir: espera a largura crescer antes de mostrar o texto */
            transition: collapsed
              ? 'opacity 0.1s ease, max-width 0.3s ease'
              : 'opacity 0.2s ease 0.18s, max-width 0.3s ease',
          }}
        >
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

      {/* Navigation Menu */}
      <nav className="flex-1 p-2">
        <ul className="space-y-0.5">
          {mainMenuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            const hasSubmenu = !!(item.submenu && item.submenu.length > 0)
            const isSubmenuActive = hasSubmenu && item.submenu!.some(sub => location.pathname === sub.path)
            const isOpen = reportsOpen
            const toggleOpen = () => setReportsOpen(v => !v)
            const menuRef = reportsMenuRef

            return (
              <li key={item.path} ref={hasSubmenu ? menuRef : undefined} className={hasSubmenu ? 'relative' : ''}>
                {hasSubmenu ? (
                  <>
                    <button
                      onClick={toggleOpen}
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
                      {!collapsed && <ChevronRight size={15} className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />}
                    </button>

                    {isOpen && menuRef?.current && createPortal(
                      <div
                        ref={reportsPopupRef}
                        className="fixed w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden"
                        style={{
                          left: menuRef.current.getBoundingClientRect().right + 8,
                          top: menuRef.current.getBoundingClientRect().top,
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
                          {item.submenu!.map((subItem) => {
                            const SubIcon = subItem.icon
                            const isSubActive = location.pathname === subItem.path
                            return (
                              <Link
                                key={subItem.path}
                                to={subItem.path}
                                onClick={() => setReportsOpen(false)}
                                className={`
                                  flex items-center gap-3 px-4 py-2 mx-1.5 rounded-lg
                                  transition-colors duration-200 text-sm
                                  ${isSubActive ? '' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}
                                `}
                                style={isSubActive ? { background: 'var(--gradient-3-4)', color: 'var(--on-gradient-3-4)' } : undefined}
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
                  </>
                ) : (
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
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Settings Menu - Separado, antes do perfil */}
      <div className={`pb-3 border-t border-gray-800 pt-3 ${collapsed ? 'px-2' : 'px-2'}`}>
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
                            style={isSubActive ? { background: 'var(--gradient-3-4)', color: 'var(--on-gradient-3-4)' } : undefined}
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

      {/* Theme Toggle */}
      <div className={`pb-2 pt-2 border-t border-gray-800 ${collapsed ? 'px-2' : 'px-3'}`}>
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
        {/* Dados da conta selecionada - ACIMA do perfil (oculto quando collapsed) */}
        {!collapsed && selectedAccount && (
          <div className="px-2 py-1.5 mb-1">
            <div className="text-xs text-gray-400 leading-tight">
              <Building2 size={12} className="inline mr-1" />
              <span className="text-gray-200 font-medium">{selectedAccount.name || 'Conta sem nome'}</span>
            </div>
            <div className="text-xs text-gray-500 leading-tight mt-0.5 ml-4">
              {selectedAccount.bank?.name || 'Banco não informado'}
              {selectedAccount.agency && ` • ${selectedAccount.agency}`}
              {selectedAccount.account_number && ` • ${selectedAccount.account_number}`}
            </div>
          </div>
        )}

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
  )
}

export default Sidebar

