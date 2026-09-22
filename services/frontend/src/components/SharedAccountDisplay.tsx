import { useState } from 'react'
import { useEffect } from 'react'
import { Users } from 'lucide-react'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'

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
  const closeModal = () => setIsModalOpen(false)

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

      {isModalOpen && (
        <CadastroModalShell maxWidth="max-w-sm" zClass="z-[110]" onBackdropClick={closeModal}>
          <CadastroModalHeader
            isEdit={false}
            title="Detalhes do Compartilhamento"
            onClose={closeModal}
            icon={<Users size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Identificação" icon={<Users size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Conta Compartilhada</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-gray-100">{displayName}</p>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Banco</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-100">
                      {bankCode && `${bankCode} - `}{bankName}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Agência</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-100">{agency}</p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Conta</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-100">{accountNumber}</p>
                  </div>
                </CadastroModalFieldsRow>
                {ownershipPercentage != null && (
                  <CadastroModalFieldsRow>
                    <div className="min-w-0">
                      <CadastroFieldLabel>Minha Contribuição</CadastroFieldLabel>
                      <p className="mt-0.5 text-sm font-semibold text-color-primary">
                        {Number(ownershipPercentage).toFixed(2)}%
                      </p>
                    </div>
                  </CadastroModalFieldsRow>
                )}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeModal} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      )}
    </>
  )
}

export default SharedAccountDisplay
