import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

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
  account_id?: number
}

interface AuthContextType {
  user: User | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  updateUser: (fields: Partial<User>) => void
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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

          setUser({
            id: userData.id.toString(),
            email: userData.email,
            nome: userData.first_name && userData.last_name
              ? `${userData.first_name} ${userData.last_name}`
              : userData.first_name || userData.last_name || userData.email.split('@')[0],
            primeiro_nome: userData.first_name,
            ultimo_nome: userData.last_name,
            role: userData.role,
            is_admin: userData.is_admin,
            tenant_id: userData.tenant_id,
            theme_mode: userData.theme_mode,
            account_id: userData.account_id
          })

          // Aplicar tema do usuário
          if (userData.theme_mode) {
            const event = new CustomEvent('user-theme-loaded', { detail: userData.theme_mode })
            window.dispatchEvent(event)
          }

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
        setUser({
          id: userData.id.toString(),
          email: userData.email,
          nome: userData.first_name && userData.last_name
            ? `${userData.first_name} ${userData.last_name}`
            : userData.first_name || userData.last_name || userData.email.split('@')[0],
          primeiro_nome: userData.first_name,
          ultimo_nome: userData.last_name,
          role: userData.role,
          is_admin: userData.is_admin,
          tenant_id: userData.tenant_id,
          theme_mode: userData.theme_mode,
          account_id: userData.account_id
        })

        // Aplicar tema do usuário
        if (userData.theme_mode) {
          const event = new CustomEvent('user-theme-loaded', { detail: userData.theme_mode })
          window.dispatchEvent(event)
        }

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
    isAdmin: !!user && user.is_admin
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

