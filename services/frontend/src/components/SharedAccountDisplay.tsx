import { useState } from 'react'
import { useEffect } from 'react'
import { Users, X } from 'lucide-react'

interface Bank {
  id?: number
  code?: string
  name?: string
  full_name?: string
}

interface Account {
  id: number
  name?: string | null
  description?: string | null
  bank?: Bank | null
  agency?: string | number | null
  account_number?: string | number | null
}

interface SharedAccountDisplayProps {
  account: Account | null | undefined
  ownershipPercentage?: number | null
  compact?: boolean  // Se true, mostra apenas nome da conta
}

/**
 * Componente para exibir conta compartilhada com ícone de informação e modal de detalhes
 * Usado em Templates, Mapeamentos e Gerenciar Cartões
 */
const SharedAccountDisplay = ({ account, ownershipPercentage, compact = false }: SharedAccountDisplayProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // ESC para fechar o modal (com stopPropagation para não fechar modais pai)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.stopImmediatePropagation()
        setIsModalOpen(false)
      }
    }

    if (isModalOpen) {
      // Usar capture: true para interceptar o evento antes dos outros handlers
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isModalOpen])

  if (!account) {
    return <span className="text-gray-400 dark:text-gray-500 italic">-</span>
  }

  // Usa account.name (nome da conta bancária)
  const displayName = account.name || 'Sem nome'
  const bankName = account.bank?.name || '-'
  const bankCode = account.bank?.code || ''
  const agency = account.agency ? String(account.agency).padStart(5, '0') + '-0' : '-'
  const accountNumber = account.account_number ? String(account.account_number).padStart(9, '0') + '-6' : '-'

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-gray-900 dark:text-white truncate" title={displayName}>
          {displayName}
        </span>
        <button
          onClick={() => setIsModalOpen(true)}
          className="p-1 text-gray-400 hover:text-color-primary transition-colors flex-shrink-0"
          title="Ver detalhes do compartilhamento"
        >
          <Users size={16} />
        </button>
      </span>

      {/* Modal de Detalhes do Compartilhamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Users size={20} className="text-color-primary" />
                Detalhes do Compartilhamento
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Conta Compartilhada</label>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{displayName}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Banco</label>
                <p className="text-sm text-gray-900 dark:text-white">
                  {bankCode && `${bankCode} - `}{bankName}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Agência</label>
                  <p className="text-sm text-gray-900 dark:text-white">{agency}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Conta</label>
                  <p className="text-sm text-gray-900 dark:text-white">{accountNumber}</p>
                </div>
              </div>
              {ownershipPercentage != null && (
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Minha Contribuição</label>
                  <p className="text-sm font-semibold text-color-primary">
                    {Number(ownershipPercentage).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:opacity-80"
                style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default SharedAccountDisplay

