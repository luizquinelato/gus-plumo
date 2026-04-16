import { useState, useRef, useCallback } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

interface ConfirmState {
  isOpen: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  type?: 'danger' | 'warning' | 'info'
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
}

export const useConfirm = () => {
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: undefined
  })

  // Refs para armazenar os resolvers da Promise
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  const callbackRef = useRef<(() => void) | null>(null)

  // Sobrecarga: suporta formato antigo (parâmetros separados) e novo (objeto com Promise)
  const showConfirm = useCallback((
    titleOrOptions: string | ConfirmOptions,
    message?: string,
    onConfirm?: () => void,
    confirmText: string = 'Confirmar',
    cancelText: string = 'Cancelar'
  ): Promise<boolean> | void => {
    // Formato novo: objeto com Promise
    if (typeof titleOrOptions === 'object') {
      const options = titleOrOptions
      setConfirmState({
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        type: options.type
      })
      callbackRef.current = null
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
      })
    }

    // Formato antigo: parâmetros separados com callback
    setConfirmState({
      isOpen: true,
      title: titleOrOptions,
      message: message || '',
      confirmText,
      cancelText,
      type: undefined
    })
    callbackRef.current = onConfirm || null
    resolveRef.current = null
  }, [])

  const handleConfirm = useCallback(() => {
    setConfirmState(prev => ({ ...prev, isOpen: false }))
    // Se tem callback (formato antigo), executa
    if (callbackRef.current) {
      callbackRef.current()
    }
    // Se tem resolver (formato novo), resolve com true
    if (resolveRef.current) {
      resolveRef.current(true)
    }
    callbackRef.current = null
    resolveRef.current = null
  }, [])

  const handleClose = useCallback(() => {
    setConfirmState(prev => ({ ...prev, isOpen: false }))
    // Se tem resolver (formato novo), resolve com false
    if (resolveRef.current) {
      resolveRef.current(false)
    }
    callbackRef.current = null
    resolveRef.current = null
  }, [])

  const ConfirmComponent = () => (
    <ConfirmDialog
      isOpen={confirmState.isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={confirmState.title}
      message={confirmState.message}
      confirmText={confirmState.confirmText}
      cancelText={confirmState.cancelText}
      type={confirmState.type}
    />
  )

  return { showConfirm, ConfirmComponent }
}

