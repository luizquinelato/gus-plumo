import { useEffect } from 'react'

/**
 * Hook para fechar modais/componentes ao pressionar ESC
 * @param onClose - Função callback a ser executada quando ESC for pressionado
 * @param isActive - Se true, o listener está ativo (default: true)
 */
export const useEscapeKey = (onClose: () => void, isActive: boolean = true) => {
  useEffect(() => {
    if (!isActive) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    // Adiciona o listener
    document.addEventListener('keydown', handleEscape)

    // Remove o listener ao desmontar
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, isActive])
}

