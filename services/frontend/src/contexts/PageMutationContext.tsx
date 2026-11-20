import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { resolvePageKey } from '../config/pageCatalog'
import { useLocation } from 'react-router-dom'

interface PageMutationContextValue {
  pageKey: string | null
}

const PageMutationContext = createContext<PageMutationContextValue>({ pageKey: null })

export function PageMutationProvider({
  pageKey,
  children,
}: {
  pageKey: string
  children: ReactNode
}) {
  const value = useMemo(() => ({ pageKey }), [pageKey])
  return <PageMutationContext.Provider value={value}>{children}</PageMutationContext.Provider>
}

/** Escrita na página atual (rota protegida) ou em `pageKey` explícito. */
export function usePageWriteAllowed(explicitPageKey?: string | null): boolean {
  const { canAccessPage } = useAuth()
  const { pageKey: routePageKey } = useContext(PageMutationContext)
  const location = useLocation()

  const key = explicitPageKey ?? routePageKey ?? resolvePageKey(location.pathname)
  if (!key) return true
  return canAccessPage(key, { write: true })
}

export function WriteGate({
  children,
  pageKey,
}: {
  children: ReactNode
  pageKey?: string
}) {
  const allowed = usePageWriteAllowed(pageKey)
  if (!allowed) return null
  return <>{children}</>
}