import { useEffect } from 'react'
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'

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

  const renderMessage = (text: string) => {
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
      iconStyle: { backgroundColor: 'var(--color-success)', color: 'var(--on-color-success)' },
    },
    error: {
      icon: XCircle,
      iconStyle: { backgroundColor: 'var(--color-danger)', color: 'var(--on-color-danger)' },
    },
    warning: {
      icon: AlertCircle,
      iconStyle: { backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' },
    },
    info: {
      icon: Info,
      iconStyle: { backgroundColor: 'var(--color-info)', color: 'var(--on-color-info)' },
    },
  }

  const { icon: Icon, iconStyle } = config[type]

  return (
    <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title={title}
        onClose={onClose}
        icon={<Icon size={18} />}
        iconStyle={iconStyle}
      />
      <CadastroModalBody>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
          {renderMessage(message)}
        </p>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={() => {
          if (secondaryButton) {
            onCloseWithoutCallback()
            secondaryButton.action()
          } else {
            onClose()
          }
        }}
        closeLabel={secondaryButton?.label ?? 'OK'}
        onSave={secondaryButton ? onClose : undefined}
        saveLabel="OK"
      />
    </CadastroModalShell>
  )
}

export default AlertDialog
