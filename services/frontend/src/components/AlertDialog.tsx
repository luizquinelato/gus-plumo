import { useEffect } from 'react'
import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-react'

export type AlertType = 'success' | 'error' | 'warning' | 'info'

interface SecondaryButton {
  label: string
  action: () => void
}

interface AlertDialogProps {
  isOpen: boolean
  onClose: () => void
  onCloseWithoutCallback: () => void
  type: AlertType
  title: string
  message: string
  secondaryButton?: SecondaryButton
}

const AlertDialog = ({ isOpen, onClose, onCloseWithoutCallback, type, title, message, secondaryButton }: AlertDialogProps) => {
  // Adicionar listener para teclas Enter, Espaço e Escape
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Função para renderizar texto com negrito (suporte a **texto**)
  const renderMessage = (text: string) => {
    // Garantir que text é uma string
    const textStr = typeof text === 'string' ? text : String(text || '')
    const parts = textStr.split(/(\*\*.*?\*\*)/)
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>
      }
      return <span key={index}>{part}</span>
    })
  }

  const config = {
    success: {
      icon: CheckCircle,
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      borderColor: 'border-green-200 dark:border-green-800',
      iconColor: 'text-green-600 dark:text-green-400',
      titleColor: 'text-green-900 dark:text-green-100',
      buttonBgColor: '--status-success'
    },
    error: {
      icon: XCircle,
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      borderColor: 'border-red-200 dark:border-red-800',
      iconColor: 'text-red-600 dark:text-red-400',
      titleColor: 'text-red-900 dark:text-red-100',
      buttonBgColor: '--status-error'
    },
    warning: {
      icon: AlertCircle,
      bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
      iconColor: 'text-yellow-600 dark:text-yellow-400',
      titleColor: 'text-yellow-900 dark:text-yellow-100',
      buttonBgColor: '--status-warning'
    },
    info: {
      icon: Info,
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      borderColor: 'border-blue-200 dark:border-blue-800',
      iconColor: 'text-blue-600 dark:text-blue-400',
      titleColor: 'text-blue-900 dark:text-blue-100',
      buttonBgColor: '--status-info'
    }
  }

  const { icon: Icon, bgColor, borderColor, iconColor, titleColor, buttonBgColor } = config[type]

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)' }}
      >
        {/* Header com ícone */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`flex-shrink-0 w-12 h-12 rounded-full ${bgColor} border ${borderColor} flex items-center justify-center`}>
            <Icon className={iconColor} size={24} />
          </div>
          <div className="flex-1">
            <h3 className={`text-lg font-semibold ${titleColor} mb-2`}>
              {title}
            </h3>
            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
              {renderMessage(message)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Botões de ação */}
        <div className="flex justify-end gap-3 mt-6">
          {secondaryButton && (
            <button
              onClick={() => {
                onCloseWithoutCallback() // Fecha o alerta SEM executar o callback principal
                secondaryButton.action() // Executa a ação do botão secundário (resetar formulário)
              }}
              className="px-6 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              {secondaryButton.label}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-6 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
            style={{ backgroundColor: `var(${buttonBgColor})` }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export default AlertDialog

