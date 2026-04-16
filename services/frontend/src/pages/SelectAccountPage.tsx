import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import axios from 'axios'
import { Building2, CreditCard, ArrowRight } from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'

interface Account {
  id: number
  name: string
  description: string | null
  account_type: string | null
  bank_name: string | null
  bank_code: string | null
  agency: string | null
  account_number: number | null
}

export default function SelectAccountPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [error, setError] = useState('')
  const [selectedAccountId, _setSelectedAccountId] = useState<number | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  const { user, logout, isLoading: isAuthLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    // Só busca contas depois que o AuthContext terminar de carregar
    if (isAuthLoading) {
      return
    }

    const fetchAccounts = async () => {
      try {
        const response = await axios.get('/api/auth/users/me/accounts')
        setAccounts(response.data.accounts || [])
      } catch (error) {
        console.error('Erro ao buscar contas:', error)
        setError('Erro ao carregar contas. Por favor, tente novamente.')
      } finally {
        setIsLoadingAccounts(false)
      }
    }

    fetchAccounts()
  }, [isAuthLoading])

  const handleSelectAccount = async (accountId: number) => {
    setIsSelecting(true)
    setError('')

    try {
      const response = await axios.post('/api/auth/select-account', {
        account_id: accountId
      })

      // Armazenar novo token
      localStorage.setItem('gus_expenses_token', response.data.access_token)
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`

      // Usar window.location.href para limpar histórico
      window.location.href = '/'
    } catch (error: any) {
      console.error('Erro ao selecionar conta:', error)
      setError(error.response?.data?.detail || 'Erro ao selecionar conta. Por favor, tente novamente.')
      setIsSelecting(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (isAuthLoading || isLoadingAccounts) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner message="Carregando contas..." size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Selecione uma Conta
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Olá, {user?.primeiro_nome || user?.email}! Escolha a conta que deseja gerenciar.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Accounts List */}
        <div className="space-y-4 mb-6">
          {accounts.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
              <Building2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                Nenhuma conta encontrada. Entre em contato com o administrador.
              </p>
            </div>
          ) : (
            accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => handleSelectAccount(account.id)}
                disabled={isSelecting}
                className={`w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 text-left border border-gray-200 dark:border-gray-700 transition-all hover:shadow-lg hover:scale-[1.02] hover:border-color-primary disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedAccountId === account.id ? 'ring-2 ring-color-primary' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="bg-color-primary-light p-3 rounded-lg">
                      <CreditCard className="w-6 h-6 text-color-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {account.name}
                      </h3>
                      {account.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {account.description}
                        </p>
                      )}
                      {account.bank_name && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          {account.bank_name}
                          {account.agency && ` • Ag: ${account.agency}`}
                          {account.account_number && ` • CC: ${account.account_number}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="w-full py-3 px-4 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Sair
        </button>
      </div>
    </div>
  )
}

