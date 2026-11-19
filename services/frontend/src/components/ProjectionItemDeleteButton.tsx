import { Trash2 } from 'lucide-react'

type Props = {
  label: string
  disabled?: boolean
  onDelete: () => void
}

/** Lixeira do lançamento: aparece no hover (e fica visível em tela de toque). */
export default function ProjectionItemDeleteButton({ label, disabled, onDelete }: Props) {
  return (
    <button
      type="button"
      aria-label={`Excluir ${label}`}
      title="Excluir"
      disabled={disabled}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onDelete()
      }}
      className="absolute right-1 top-1 z-10 rounded p-0.5 opacity-0 transition-opacity hover:bg-white/80 group-hover/item:opacity-100 disabled:pointer-events-none [@media(hover:none)]:right-1.5 [@media(hover:none)]:top-1.5 [@media(hover:none)]:p-1.5 [@media(hover:none)]:opacity-100 dark:hover:bg-gray-900/70"
      style={{ color: 'var(--color-delete)' }}
    >
      <Trash2 className="h-3.5 w-3.5 [@media(hover:none)]:h-4 [@media(hover:none)]:w-4" />
    </button>
  )
}
