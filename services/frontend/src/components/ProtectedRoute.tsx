import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth()

  // Mostrar loading enquanto verifica autenticação
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white dark:bg-gray-800 rounded-full shadow-lg mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            Carregando...
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Verificando autenticação
          </p>
        </div>
      </div>
    )
  }

  // Redirecionar para login se não estiver autenticado
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Redirecionar para seleção de conta se não tiver conta selecionada
  if (!user?.account_id) {
    return <Navigate to="/select-account" replace />
  }

  // Renderizar conteúdo protegido
  return <>{children}</>
}

