import { CheckSquare, MinusSquare, Square } from 'lucide-react'

export type HeaderCheckState = 'none' | 'partial' | 'all'

interface BulkSelectCheckboxProps {
  state?: HeaderCheckState
  checked?: boolean
  onClick: () => void
  title?: string
  disabled?: boolean
  accentColor?: string
}

export default function BulkSelectCheckbox({
  state,
  checked,
  onClick,
  title,
  disabled,
  accentColor = 'var(--color-1)',
}: BulkSelectCheckboxProps) {
  const effective: HeaderCheckState = state ?? (checked ? 'all' : 'none')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? (effective === 'none' ? 'Selecionar' : 'Desmarcar')}
      className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded transition-colors ${
        disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {effective === 'none' && <Square size={18} className="text-gray-500 dark:text-gray-300" />}
      {effective === 'partial' && <MinusSquare size={18} style={{ color: accentColor }} />}
      {effective === 'all' && <CheckSquare size={18} style={{ color: accentColor }} />}
    </button>
  )
}
