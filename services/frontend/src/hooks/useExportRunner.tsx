import { useCallback, useState, type ReactNode } from 'react'
import LoadingSpinner from '../components/LoadingSpinner'

/** Cede o controle ao navegador para que o spinner seja desenhado antes de um trabalho síncrono pesado. */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })

export interface ExportRunner {
  /** Executa a exportação com overlay de carregamento. Retorna false se falhou ou se já havia uma em curso. */
  run: (label: string, task: () => void | Promise<void>) => Promise<boolean>
  /** Renderize uma vez na página. */
  overlay: ReactNode
}

/**
 * Overlay "Gerando PDF…/Excel…" para exportações demoradas.
 * Bloqueia cliques durante a geração (evita exportação duplicada) e desliga no finally.
 */
export function useExportRunner(onError?: (message: string) => void): ExportRunner {
  const [label, setLabel] = useState<string | null>(null)

  const run = useCallback(
    async (nextLabel: string, task: () => void | Promise<void>) => {
      if (label !== null) return false
      setLabel(nextLabel)
      try {
        await nextPaint()
        await task()
        return true
      } catch (err) {
        console.error('Falha ao gerar exportação', err)
        onError?.('Não foi possível gerar o arquivo.')
        return false
      } finally {
        setLabel(null)
      }
    },
    [label, onError],
  )

  const overlay = label ? (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-gray-900/70"
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner message={label} />
    </div>
  ) : null

  return { run, overlay }
}
