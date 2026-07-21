import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

interface BalanceVisibilityContextType {
  hideBalanceValues: boolean
  toggleBalanceVisibility: () => void
}

const BalanceVisibilityContext = createContext<BalanceVisibilityContextType | undefined>(undefined)

const BALANCE_VISIBILITY_STORAGE_KEY = 'hide-balance-values'

const readStoredHidden = (): boolean => {
  return localStorage.getItem(BALANCE_VISIBILITY_STORAGE_KEY) === 'true'
}

const persistHidden = (hidden: boolean) => {
  localStorage.setItem(BALANCE_VISIBILITY_STORAGE_KEY, String(hidden))
}

export const BalanceVisibilityProvider = ({ children }: { children: ReactNode }) => {
  const [hideBalanceValues, setHideBalanceValues] = useState(readStoredHidden)

  useEffect(() => {
    const handleUserBalanceVisibilityLoaded = (event: CustomEvent) => {
      const hidden = Boolean(event.detail)
      setHideBalanceValues(hidden)
      persistHidden(hidden)
    }

    window.addEventListener(
      'user-balance-visibility-loaded',
      handleUserBalanceVisibilityLoaded as EventListener
    )
    return () => {
      window.removeEventListener(
        'user-balance-visibility-loaded',
        handleUserBalanceVisibilityLoaded as EventListener
      )
    }
  }, [])

  const toggleBalanceVisibility = () => {
    setHideBalanceValues(prev => {
      const next = !prev
      persistHidden(next)

      const token = localStorage.getItem('gus_expenses_token')
      if (token) {
        axios.patch('/api/user/preferences/balance-visibility', {
          hide_balance_values: next,
        }, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).catch(error => {
          console.error('Erro ao salvar preferência de visibilidade de saldos:', error)
        })
      }

      return next
    })
  }

  return (
    <BalanceVisibilityContext.Provider value={{ hideBalanceValues, toggleBalanceVisibility }}>
      {children}
    </BalanceVisibilityContext.Provider>
  )
}

export const useBalanceVisibility = () => {
  const context = useContext(BalanceVisibilityContext)
  if (context === undefined) {
    throw new Error('useBalanceVisibility must be used within a BalanceVisibilityProvider')
  }
  return context
}
