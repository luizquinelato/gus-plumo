import { AlertTriangle, Info } from 'lucide-react'
import { useEffect } from 'react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
  zClass?: string
}

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  type = 'warning',
  zClass = 'z-[110]',
}: ConfirmDialogProps) => {
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onConfirm])

  if (!isOpen) return null

  const iconStyle =
    type === 'danger'
      ? { backgroundColor: 'var(--color-danger)', color: 'var(--on-color-danger)' }
      : type === 'info'
        ? { backgroundColor: 'var(--color-info)', color: 'var(--on-color-info)' }
        : { backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }

  return (
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose} zClass={zClass}>
      <CadastroModalHeader
        isEdit={false}
        title={title}
        onClose={onClose}
        icon={type === 'info' ? <Info size={18} /> : <AlertTriangle size={18} />}
        iconStyle={iconStyle}
      />
      <CadastroModalBody>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{message}</p>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={handleConfirm}
        closeLabel={cancelText}
        saveLabel={confirmText}
        saveTone={type === 'danger' ? 'danger' : type === 'info' ? 'default' : 'success'}
      />
    </CadastroModalShell>
  )
}

export default ConfirmDialog
