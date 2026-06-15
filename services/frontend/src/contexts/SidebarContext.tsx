import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

interface SidebarContextType {
  collapsed: boolean
  toggleCollapsed: () => void
  sidebarLeftClass: 'left-16' | 'left-64'
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed'

const readStoredCollapsed = (): boolean => {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
}

const persistCollapsed = (collapsed: boolean) => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
}

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)

  useEffect(() => {
    const handleUserSidebarLoaded = (event: CustomEvent) => {
      const sidebarCollapsed = Boolean(event.detail)
      setCollapsed(sidebarCollapsed)
      persistCollapsed(sidebarCollapsed)
    }

    window.addEventListener('user-sidebar-loaded', handleUserSidebarLoaded as EventListener)
    return () => {
      window.removeEventListener('user-sidebar-loaded', handleUserSidebarLoaded as EventListener)
    }
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      persistCollapsed(next)

      const token = localStorage.getItem('gus_expenses_token')
      if (token) {
        axios.patch('/api/user/preferences/sidebar', {
          sidebar_collapsed: next,
        }, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }).catch(error => {
          console.error('Erro ao salvar preferência do sidebar:', error)
        })
      }

      return next
    })
  }

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed,
        sidebarLeftClass: collapsed ? 'left-16' : 'left-64',
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
