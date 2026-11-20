import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface PageAccessRouteProps {
  pageKey: string
  children: React.ReactNode
}

export default function PageAccessRoute({ pageKey, children }: PageAccessRouteProps) {
  const { isLoading, isAuthenticated, canAccessPage } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Carregando…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!canAccessPage(pageKey)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Acesso negado</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Você não tem permissão para acessar esta página. Fale com um administrador do tenant.
        </p>
      </div>
    )
  }

  return <>{children}</>
}