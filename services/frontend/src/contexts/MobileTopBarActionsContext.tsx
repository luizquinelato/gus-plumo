import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type MobileTopBarActionsContextValue = {
  actions: ReactNode
  setActions: (node: ReactNode | null) => void
}

const MobileTopBarActionsContext = createContext<MobileTopBarActionsContextValue | undefined>(
  undefined,
)

export function MobileTopBarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<ReactNode>(null)

  const setActions = useCallback((node: ReactNode | null) => {
    setActionsState(node)
  }, [])

  const value = useMemo(
    () => ({
      actions,
      setActions,
    }),
    [actions, setActions],
  )

  return (
    <MobileTopBarActionsContext.Provider value={value}>{children}</MobileTopBarActionsContext.Provider>
  )
}

export function useMobileTopBarActions() {
  const ctx = useContext(MobileTopBarActionsContext)
  if (!ctx) {
    throw new Error('useMobileTopBarActions must be used within MobileTopBarActionsProvider')
  }
  return ctx
}