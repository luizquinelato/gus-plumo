import React, { useState, useEffect } from 'react'
import { Copy, CheckCircle, XCircle } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import axios from 'axios'

interface Account {
  id: number
  name: string
  bank_name: string
  agency: string
  account_number: number
}

const SettingsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [currentAccountId, setCurrentAccountId] = useState<number | null>(null)
  const [destinationAccountId, setDestinationAccountId] = useState<number | null>(null)
  const [copyTags, setCopyTags] = useState(true)
  const [copySubtags, setCopySubtags] = useState(true)
  const [copyMappings, setCopyMappings] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    loadCurrentAccount()
    loadAccounts()
  }, [])

  const loadCurrentAccount = async () => {
    try {
      // Obtém informações do usuário atual (inclui account_id se selecionada)
      const response = await axios.get('/api/auth/verify')
      if (response.data.valid && response.data.user?.account_id) {
        setCurrentAccountId(response.data.user.account_id)
      }
    } catch (error) {
      console.error('Erro ao carregar conta atual:', error)
    }
  }

  const loadAccounts = async () => {
    try {
      const response = await axios.get('/api/accounts/')
      setAccounts(response.data)
    } catch (error) {
      console.error('Erro ao carregar contas:', error)
      setMessage({ type: 'error', text: 'Erro ao carregar contas' })
    }
  }

  const handleCopySettings = async () => {
    if (!currentAccountId) {
      setMessage({ type: 'error', text: 'Conta de origem não identificada. Por favor, selecione uma conta.' })
      return
    }

    if (!destinationAccountId) {
      setMessage({ type: 'error', text: 'Selecione a conta de destino' })
      return
    }

    if (currentAccountId === destinationAccountId) {
      setMessage({ type: 'error', text: 'A conta de destino deve ser diferente da conta atual' })
      return
    }

    if (!copyTags && !copySubtags && !copyMappings) {
      setMessage({ type: 'error', text: 'Selecione pelo menos uma opção para copiar' })
      return
    }

    setIsLoading(true)
    setMessage(null)

    try {
      const response = await axios.post('/api/settings/copy-settings', {
        source_account_id: currentAccountId,
        destination_account_id: destinationAccountId,
        copy_tags: copyTags,
        copy_subtags: copySubtags,
        copy_mappings: copyMappings
      })

      setMessage({ type: 'success', text: response.data.message })

      // Reset form
      setDestinationAccountId(null)
      setCopyTags(true)
      setCopySubtags(true)
      setCopyMappings(true)
    } catch (error: any) {
      console.error('Erro ao copiar configurações:', error)
      setMessage({
        type: 'error',
        text: error.response?.data?.detail || 'Erro ao copiar configurações'
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                Configurações
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Gerencie suas configurações e copie entre contas
              </p>
            </div>
          </div>

          {/* Copy Settings Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6"
            style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
          >
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <Copy className="w-6 h-6 text-primary-600" />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Copiar Configurações Entre Contas
                </h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Copie tags, subtags e mapeamentos da sua conta atual para outra conta. Apenas configurações que não existem na conta de destino serão copiadas.
              </p>
            </div>

            {/* Message */}
            {message && (
              <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                message.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                <span className="text-sm">{message.text}</span>
              </div>
            )}

            {/* Form */}
            <div className="space-y-6">
              {/* Destination Account */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Conta de Destino
                </label>
                <select
                  value={destinationAccountId || ''}
                  onChange={(e) => setDestinationAccountId(Number(e.target.value) || null)}
                  disabled={!currentAccountId}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Selecione a conta de destino</option>
                  {accounts
                    .filter(account => account.id !== currentAccountId)
                    .map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} - {account.bank_name} (Ag: {account.agency}, Conta: {account.account_number})
                      </option>
                    ))
                  }
                </select>
              </div>

              {/* Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  O que deseja copiar?
                </label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyTags}
                      onChange={(e) => setCopyTags(e.target.checked)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Tags
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copySubtags}
                      onChange={(e) => setCopySubtags(e.target.checked)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Subtags
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyMappings}
                      onChange={(e) => setCopyMappings(e.target.checked)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Mapeamentos de Transações
                    </span>
                  </label>
                </div>
              </div>

              {/* Copy Button */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={handleCopySettings}
                  disabled={isLoading || !currentAccountId || !destinationAccountId}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  {isLoading ? 'Copiando...' : 'Copiar Configurações'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default SettingsPage

