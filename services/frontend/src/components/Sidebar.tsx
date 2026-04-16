import { Home, Palette, TrendingUp, Sun, Moon, CreditCard, LogOut, Tags, ClipboardCheck, FolderTree, Settings, ChevronRight, Building2, Users, User, BarChart3, FileText, RefreshCw, Copy, Scale, Layers, Wallet } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'

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
  const { user, logout } = useAuth()
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<SelectedAccount | null>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  // Refs para os flyout menus (botões no sidebar)
  const settingsMenuRef = useRef<HTMLLIElement>(null)
  const mappingsMenuRef = useRef<HTMLLIElement>(null)
  const reportsMenuRef = useRef<HTMLLIElement>(null)

  // Refs para os flyout popups (renderizados via Portal)
  const settingsPopupRef = useRef<HTMLDivElement>(null)
  const mappingsPopupRef = useRef<HTMLDivElement>(null)
  const reportsPopupRef = useRef<HTMLDivElement>(null)
  const profilePopupRef = useRef<HTMLDivElement>(null)

  // Estados dos submenus flyout
  const [mappingsOpen, setMappingsOpen] = useState(false)
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
      // Fecha flyout de mapeamentos (verifica botão E popup)
      if (
        mappingsMenuRef.current && !mappingsMenuRef.current.contains(target) &&
        (!mappingsPopupRef.current || !mappingsPopupRef.current.contains(target))
      ) {
        setMappingsOpen(false)
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

  // Menus principais: Home primeiro, depois ordenados alfabeticamente
  const mainMenuItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: Scale, label: 'Balanço', path: '/balanco' },
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
    { icon: FileText, label: 'Templates', path: '/templates' },
  ]

  // Menu de configurações (abaixo da linha divisória, antes do perfil)
  const settingsMenuItem = {
    icon: Settings,
    label: 'Configurações',
    path: '/configuracoes',
    submenu: [
      { icon: Users, label: 'Compartilhamentos', path: '/configuracoes/compartilhamentos' },
      { icon: Building2, label: 'Contas', path: '/configuracoes/contas' },
      { icon: CreditCard, label: 'Cartões', path: '/configuracoes/cartoes' },
      { icon: Tags, label: 'Tags & Subtags', path: '/configuracoes/tags-subtags' },
    ]
  }

  return (
    <aside className="w-64 bg-gray-900 dark:bg-gray-900 text-white flex flex-col border-r border-gray-700 dark:border-gray-700 overflow-visible">
      {/* Logo/Brand */}
      <div
        className="p-6 flex flex-col gap-4"
        style={{
          background: 'var(--gradient-1-2)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.8)'
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h1
              className="text-3xl font-black tracking-wider mb-2 flex items-center gap-2"
              style={{ color: 'var(--on-gradient-1-2)' }}
            >
              PLUMO
              {import.meta.env.MODE === 'dev' && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-400 text-yellow-900 tracking-normal align-middle">
                  DEV
                </span>
              )}
            </h1>
            <p
              className="text-xs italic"
              style={{ color: 'var(--on-gradient-1-2)', opacity: 0.8 }}
            >
              Finanças leves, vida plena
            </p>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors self-start"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.2)'}
            title={theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}
          >
            {theme === 'light' ? (
              <Moon size={20} style={{ color: 'var(--on-gradient-1-2)' }} />
            ) : (
              <Sun size={20} style={{ color: 'var(--on-gradient-1-2)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {mainMenuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            const hasSubmenu = item.submenu && item.submenu.length > 0
            const isSubmenuActive = hasSubmenu && item.submenu.some(sub => location.pathname === sub.path)

            // Determina qual estado e ref de submenu usar baseado no label
            const isOpen = item.label === 'Relatórios'
              ? reportsOpen
              : mappingsOpen
            const toggleOpen = item.label === 'Relatórios'
              ? () => setReportsOpen(!reportsOpen)
              : () => setMappingsOpen(!mappingsOpen)
            const menuRef = item.label === 'Relatórios'
              ? reportsMenuRef
              : mappingsMenuRef

            return (
              <li key={item.path} ref={hasSubmenu ? menuRef : undefined} className={hasSubmenu ? 'relative' : ''}>
                {hasSubmenu ? (
                  <>
                    {/* Menu item with submenu - Flyout */}
                    <button
                      onClick={toggleOpen}
                      className={`
                        w-full flex items-center gap-3 px-4 py-2 rounded-lg
                        transition-colors duration-200
                        ${isSubmenuActive
                          ? ''
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        }
                      `}
                      style={isSubmenuActive ? {
                        background: 'var(--gradient-1-2)',
                        color: 'var(--on-gradient-1-2)'
                      } : undefined}
                    >
                      <Icon size={20} />
                      <span className="font-medium flex-1 text-left">{item.label}</span>
                      <ChevronRight size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Submenu Flyout - Abre para a direita usando Portal */}
                    {isOpen && menuRef?.current && createPortal(
                      <div
                        ref={
                          item.label === 'Relatórios' ? reportsPopupRef
                          : mappingsPopupRef
                        }
                        className="fixed w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2"
                        style={{
                          left: menuRef.current.getBoundingClientRect().right + 8,
                          top: menuRef.current.getBoundingClientRect().top,
                          zIndex: 99999
                        }}
                      >
                        {item.submenu.map((subItem) => {
                          const SubIcon = subItem.icon
                          const isSubActive = location.pathname === subItem.path

                          return (
                            <Link
                              key={subItem.path}
                              to={subItem.path}
                              onClick={() => {
                                // Fecha o flyout ao clicar
                                if (item.label === 'Relatórios') setReportsOpen(false)
                                else setMappingsOpen(false)
                              }}
                              className={`
                                w-full flex items-center gap-3 px-4 py-2 mx-1 rounded-lg
                                transition-colors duration-200 text-sm
                                ${isSubActive
                                  ? ''
                                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                                }
                              `}
                              style={isSubActive ? {
                                background: 'var(--gradient-3-4)',
                                color: 'var(--on-gradient-3-4)'
                              } : undefined}
                            >
                              <SubIcon size={18} />
                              <span className="font-medium">{subItem.label}</span>
                            </Link>
                          )
                        })}
                      </div>,
                      document.body
                    )}
                  </>
                ) : (
                  /* Regular menu item */
                  <Link
                    to={item.path}
                    className={`
                      flex items-center gap-3 px-4 py-2 rounded-lg
                      transition-colors duration-200
                      ${isActive
                        ? ''
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }
                    `}
                    style={isActive ? {
                      background: 'var(--gradient-1-2)',
                      color: 'var(--on-gradient-1-2)'
                    } : undefined}
                  >
                    <Icon size={20} />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                )}
              </li>
            )
          })}

        </ul>
      </nav>

      {/* Settings Menu - Separado, antes do perfil */}
      <div className="px-4 pb-4 border-t border-gray-800 pt-4">
        <ul className="space-y-1">
          {(() => {
            const item = settingsMenuItem
            const Icon = item.icon
            const hasSubmenu = item.submenu && item.submenu.length > 0
            const isSubmenuActive = hasSubmenu && item.submenu.some(sub => location.pathname === sub.path)

            return (
              <li key={item.path} ref={settingsMenuRef} className="relative">
                {/* Menu item with submenu - Flyout */}
                <button
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2 rounded-lg
                    transition-colors duration-200
                    ${isSubmenuActive
                      ? ''
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }
                  `}
                  style={isSubmenuActive ? {
                    background: 'var(--gradient-1-2)',
                    color: 'var(--on-gradient-1-2)'
                  } : undefined}
                >
                  <Icon size={20} />
                  <span className="font-medium flex-1 text-left">{item.label}</span>
                  <ChevronRight size={16} className={`transition-transform duration-200 ${settingsOpen ? 'rotate-90' : ''}`} />
                </button>

                {/* Submenu Flyout - Abre para a direita usando Portal */}
                {settingsOpen && settingsMenuRef?.current && createPortal(
                  <div
                    ref={settingsPopupRef}
                    className="fixed w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2"
                    style={{
                      left: settingsMenuRef.current.getBoundingClientRect().right + 8,
                      top: settingsMenuRef.current.getBoundingClientRect().top,
                      zIndex: 99999
                    }}
                  >
                    {item.submenu.map((subItem) => {
                      const SubIcon = subItem.icon
                      const isSubActive = location.pathname === subItem.path

                      return (
                        <Link
                          key={subItem.path}
                          to={subItem.path}
                          onClick={() => {
                            // Fecha o flyout ao clicar
                            setSettingsOpen(false)
                          }}
                          className={`
                            w-full flex items-center gap-3 px-4 py-2 mx-1 rounded-lg
                            transition-colors duration-200 text-sm
                            ${isSubActive
                              ? ''
                              : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                            }
                          `}
                          style={isSubActive ? {
                            background: 'var(--gradient-3-4)',
                            color: 'var(--on-gradient-3-4)'
                          } : undefined}
                        >
                          <SubIcon size={18} />
                          <span className="font-medium">{subItem.label}</span>
                        </Link>
                      )
                    })}
                  </div>,
                  document.body
                )}
              </li>
            )
          })()}
        </ul>
      </div>

      {/* User Profile Section */}
      <div className="p-4 border-t border-gray-800 relative" ref={profileMenuRef}>
        {/* Profile Button */}
        <div>
          {/* Dados da conta selecionada - ACIMA do perfil */}
          {selectedAccount && (
            <div className="px-3 py-1.5 mb-1">
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
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors duration-200"
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: 'var(--gradient-2-3)',
                color: 'var(--on-gradient-2-3)'
              }}
            >
              <span className="text-base font-bold">
                {user?.primeiro_nome?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </span>
            </div>
            <div className="flex-1 text-left min-w-0">
              {/* Nome do usuário em uma linha */}
              <p className="font-medium text-white text-sm truncate">
                {user?.nome || user?.email || 'Usuário'}
              </p>

              {/* Role do usuário */}
              <p className="text-xs text-gray-400">
                {user?.is_admin ? 'Administrador' : 'Usuário'}
              </p>
            </div>
            <ChevronRight
              size={18}
              className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${isProfileMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Dropdown Menu - Abre para o lado direito usando Portal */}
        {isProfileMenuOpen && profileMenuRef.current && createPortal(
          <div
            ref={profilePopupRef}
            className="fixed w-52 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2"
            style={{
              left: profileMenuRef.current.getBoundingClientRect().right + 8,
              bottom: window.innerHeight - profileMenuRef.current.getBoundingClientRect().bottom,
              zIndex: 99999
            }}
          >
            {/* Configurações - Apenas para Admin */}
            {user?.is_admin && (
              <>
                <div className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Configurações
                </div>
                <button
                  onClick={() => {
                    navigate('/settings/colors')
                    setIsProfileMenuOpen(false)
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200 ${location.pathname === '/settings/colors' ? 'bg-gray-700 text-white' : ''}`}
                >
                  <Palette size={18} />
                  <span className="font-medium text-sm">Cores</span>
                </button>
                <button
                  onClick={() => {
                    navigate('/settings')
                    setIsProfileMenuOpen(false)
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200 ${location.pathname === '/settings' ? 'bg-gray-700 text-white' : ''}`}
                >
                  <Copy size={18} />
                  <span className="font-medium text-sm">Copiar Configurações</span>
                </button>
                <div className="my-2 border-t border-gray-700"></div>
              </>
            )}

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
    </aside>
  )
}

export default Sidebar

