import { useState, useRef } from 'react'
import AlertDialog, { AlertType } from '../components/AlertDialog'

interface SecondaryButton {
  label: string
  action: () => void
}

interface AlertState {
  isOpen: boolean
  type: AlertType
  title: string
  message: string
  secondaryButton?: SecondaryButton
}

export const useAlert = () => {
  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
    secondaryButton: undefined
  })

  const onCloseCallbackRef = useRef<(() => void) | null>(null)

  const showAlert = (
    type: AlertType,
    title: string,
    message: string,
    onCloseCallback?: () => void,
    secondaryButton?: SecondaryButton
  ) => {
    setAlertState({
      isOpen: true,
      type,
      title,
      message,
      secondaryButton
    })
    onCloseCallbackRef.current = onCloseCallback || null
  }

  const closeAlert = () => {
    setAlertState(prev => ({ ...prev, isOpen: false }))
    // Executa callback se existir
    if (onCloseCallbackRef.current) {
      onCloseCallbackRef.current()
      onCloseCallbackRef.current = null
    }
  }

  const closeAlertWithoutCallback = () => {
    setAlertState(prev => ({ ...prev, isOpen: false }))
    // NÃO executa o callback - usado pelo botão secundário
    onCloseCallbackRef.current = null
  }

  const AlertComponent = () => (
    <AlertDialog
      isOpen={alertState.isOpen}
      onClose={closeAlert}
      onCloseWithoutCallback={closeAlertWithoutCallback}
      type={alertState.type}
      title={alertState.title}
      message={alertState.message}
      secondaryButton={alertState.secondaryButton}
    />
  )

  return {
    showSuccess: (title: string, message: string, onCloseCallback?: () => void, secondaryButton?: SecondaryButton) =>
      showAlert('success', title, message, onCloseCallback, secondaryButton),
    showError: (title: string, message: string, onCloseCallback?: () => void, secondaryButton?: SecondaryButton) =>
      showAlert('error', title, message, onCloseCallback, secondaryButton),
    showWarning: (title: string, message: string, onCloseCallback?: () => void, secondaryButton?: SecondaryButton) =>
      showAlert('warning', title, message, onCloseCallback, secondaryButton),
    showInfo: (title: string, message: string, onCloseCallback?: () => void, secondaryButton?: SecondaryButton) =>
      showAlert('info', title, message, onCloseCallback, secondaryButton),
    AlertComponent
  }
}

