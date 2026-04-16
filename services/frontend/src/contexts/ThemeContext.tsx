import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setThemeFromUser: (userTheme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme') as Theme
    return savedTheme || 'light'
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Escuta evento de tema carregado do usuário
  useEffect(() => {
    const handleUserThemeLoaded = (event: CustomEvent) => {
      const userTheme = event.detail as Theme
      if (userTheme && (userTheme === 'light' || userTheme === 'dark')) {
        setTheme(userTheme)
      }
    }

    window.addEventListener('user-theme-loaded', handleUserThemeLoaded as EventListener)
    return () => {
      window.removeEventListener('user-theme-loaded', handleUserThemeLoaded as EventListener)
    }
  }, [])

  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)

    // Salva no banco de dados
    try {
      // Pega o token do localStorage
      const token = localStorage.getItem('gus_expenses_token')
      if (!token) {
        return
      }

      await axios.patch('/api/user/preferences/theme', {
        theme_mode: newTheme
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
    } catch (error) {
      console.error('Erro ao salvar preferência de tema:', error)
    }
  }

  const setThemeFromUser = (userTheme: Theme) => {
    setTheme(userTheme)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeFromUser }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

