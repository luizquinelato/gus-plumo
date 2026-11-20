import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import axios from 'axios'
import { PLUMO_APP_PAGES } from '../config/pageCatalog'

export type PageAccessEntry = { can_read: boolean; can_write: boolean }

// Configurar base URL do backend (usa variável de ambiente ou default)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
axios.defaults.baseURL = API_BASE_URL

interface User {
  id: string
  email: string
  nome: string
  primeiro_nome: string
  ultimo_nome: string
  role: string
  is_admin: boolean
  tenant_id: number
  theme_mode?: string
  sidebar_collapsed?: boolean
  hide_balance_values?: boolean
  account_id?: number
  avatar_url?: string
  pages?: Record<string, PageAccessEntry>
}

interface AuthContextType {
  user: User | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  updateUser: (fields: Partial<User>) => void
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  canAccessPage: (pageKey: string, opts?: { write?: boolean }) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

function mapApiUser(userData: Record<string, unknown>): User {
  return {
    id: String(userData.id),
    email: String(userData.email),
    nome:
      userData.first_name && userData.last_name
        ? `${userData.first_name} ${userData.last_name}`
        : String(userData.first_name || userData.last_name || String(userData.email).split('@')[0]),
    primeiro_nome: String(userData.first_name ?? ''),
    ultimo_nome: String(userData.last_name ?? ''),
    role: String(userData.role || 'user'),
    is_admin: Boolean(userData.is_admin),
    tenant_id: Number(userData.tenant_id),
    theme_mode: userData.theme_mode as string | undefined,
    sidebar_collapsed: Boolean(userData.sidebar_collapsed ?? false),
    hide_balance_values: Boolean(userData.hide_balance_values ?? false),
    account_id: userData.account_id as number | undefined,
    avatar_url: (userData.avatar_url as string | undefined) || undefined,
    pages: (userData.pages as Record<string, PageAccessEntry> | undefined) || undefined,
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const canAccessPage = useCallback(
    (pageKey: string, opts?: { write?: boolean }) => {
      if (!user) return false
      if (user.is_admin) return true
      const pageMeta = PLUMO_APP_PAGES.find((p) => p.page_key === pageKey)
      if (pageMeta?.admin_only) return false
      const entry = user.pages?.[pageKey]
      if (!entry?.can_read) return false
      if (opts?.write) return Boolean(entry.can_write)
      return true
    },
    [user],
  )

  // Validar token ao carregar a aplicação
  useEffect(() => {
    const validateToken = async () => {
      const token = localStorage.getItem('gus_expenses_token')
      
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        // Configurar header de autorização
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`

        // Validar token com o backend
        const response = await axios.get('/api/auth/verify')

        if (response.data.valid && response.data.user) {
          const userData = response.data.user

          setUser(mapApiUser(userData as Record<string, unknown>))

          // Aplicar tema do usuário
          if (userData.theme_mode) {
            const event = new CustomEvent('user-theme-loaded', { detail: userData.theme_mode })
            window.dispatchEvent(event)
          }

          // Aplicar preferência do sidebar do usuário
          const sidebarEvent = new CustomEvent('user-sidebar-loaded', {
            detail: userData.sidebar_collapsed ?? false,
          })
          window.dispatchEvent(sidebarEvent)

          const balanceVisibilityEvent = new CustomEvent('user-balance-visibility-loaded', {
            detail: userData.hide_balance_values ?? false,
          })
          window.dispatchEvent(balanceVisibilityEvent)

          // Atualizar cores do tenant (sincronização no refresh)
          if (response.data.color_schema_mode) {
            localStorage.setItem('gus_expenses_color_mode', response.data.color_schema_mode)
          }
          if (response.data.colors && response.data.colors.length > 0) {
            localStorage.setItem('gus_expenses_color_data', JSON.stringify(response.data.colors))
            localStorage.setItem('gus_expenses_color_data_timestamp', Date.now().toString())
            // Disparar evento para aplicar cores imediatamente
            window.dispatchEvent(new CustomEvent('colorDataLoaded'))
          }
        } else {
          localStorage.removeItem('gus_expenses_token')
          delete axios.defaults.headers.common['Authorization']
        }
      } catch (error) {
        console.error('Erro ao validar token:', error)
        localStorage.removeItem('gus_expenses_token')
        delete axios.defaults.headers.common['Authorization']
      } finally {
        setIsLoading(false)
      }
    }

    validateToken()
  }, [])

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (!axios.isAxiosError(error) || error.response?.status !== 401) {
          return Promise.reject(error)
        }
        const url = error.config?.url ?? ''
        if (url.includes('/api/auth/login') || url.includes('/api/auth/verify')) {
          return Promise.reject(error)
        }
        localStorage.removeItem('gus_expenses_token')
        delete axios.defaults.headers.common['Authorization']
        setUser(null)
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
        return Promise.reject(error)
      },
    )
    return () => {
      axios.interceptors.response.eject(interceptor)
    }
  }, [])

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)

    try {
      // Fazer requisição de login para o backend
      const response = await axios.post('/api/auth/login', {
        email: email.toLowerCase().trim(),
        password: password
      })

      if (response.data.access_token && response.data.user) {
        const { access_token, user: userData } = response.data

        // Armazenar token PRIMEIRO
        localStorage.setItem('gus_expenses_token', access_token)

        // Configurar header de autorização ANTES de fazer qualquer chamada
        axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

        // Load tenant's color_schema_mode and colors BEFORE setting user
        try {
          const colorResponse = await axios.get('/api/tenant/colors/unified', {
            headers: {
              'Authorization': `Bearer ${access_token}`
            }
          })

          if (colorResponse.data.success) {
            // Save color mode
            if (colorResponse.data.color_schema_mode) {
              localStorage.setItem('gus_expenses_color_mode', colorResponse.data.color_schema_mode)
            }

            // Save all colors to localStorage
            if (colorResponse.data.colors) {
              localStorage.setItem('gus_expenses_color_data', JSON.stringify(colorResponse.data.colors))
              localStorage.setItem('gus_expenses_color_data_timestamp', Date.now().toString())

              // Dispatch event to apply colors immediately
              window.dispatchEvent(new CustomEvent('colorDataLoaded'))
            }
          }
        } catch (error: any) {
          console.warn('Failed to load tenant colors, using defaults')
          // Default to 'default' mode if loading fails
          localStorage.setItem('gus_expenses_color_mode', 'default')
        }

        // Definir dados do usuário DEPOIS de carregar cores
        setUser(mapApiUser(userData as Record<string, unknown>))

        // Aplicar tema do usuário
        if (userData.theme_mode) {
          const event = new CustomEvent('user-theme-loaded', { detail: userData.theme_mode })
          window.dispatchEvent(event)
        }

        // Aplicar preferência do sidebar do usuário
        const sidebarEvent = new CustomEvent('user-sidebar-loaded', {
          detail: userData.sidebar_collapsed ?? false,
        })
        window.dispatchEvent(sidebarEvent)

        const balanceVisibilityEvent = new CustomEvent('user-balance-visibility-loaded', {
          detail: userData.hide_balance_values ?? false,
        })
        window.dispatchEvent(balanceVisibilityEvent)

        return true
      }

      return false
    } catch (error) {
      console.error('Erro ao fazer login:', error)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    // Limpar token
    localStorage.removeItem('gus_expenses_token')

    // Remover header de autorização
    delete axios.defaults.headers.common['Authorization']

    // Limpar estado do usuário
    setUser(null)
  }

  const updateUser = (fields: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...fields } : prev)
  }

  const value: AuthContextType = {
    user,
    login,
    logout,
    updateUser,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: !!user && user.is_admin,
    canAccessPage,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider')
  }
  return context
}

