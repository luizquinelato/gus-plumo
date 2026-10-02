import type { InputHTMLAttributes, ReactNode } from 'react'
import Badge from './Badge'
import { CadastroFieldLabel, cadastroFieldCls } from './CadastroFormLayout'
import {
  isProprioOwnershipPercent,
  OWNERSHIP_PERCENT_HINT,
  OWNERSHIP_PERCENT_LABEL,
  type OwnershipPercentContext,
} from '../utils/ownershipPercentUi'

type OwnershipPercentFieldProps = {
  context: OwnershipPercentContext
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  required?: boolean
  label?: ReactNode
  hint?: ReactNode
  showProprioBadge?: boolean
  /** Oculta o texto de ajuda (ex.: grade compacta de template). */
  compact?: boolean
  className?: string
  inputClassName?: string
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'id'>

export default function OwnershipPercentField({
  context,
  value,
  onChange,
  onBlur,
  disabled,
  required,
  label,
  hint,
  showProprioBadge = true,
  compact = false,
  className = '',
  inputClassName = '',
  placeholder = '0.00',
  id,
}: OwnershipPercentFieldProps) {
  const showBadge = showProprioBadge && !disabled && isProprioOwnershipPercent(value)
  const resolvedLabel = label ?? OWNERSHIP_PERCENT_LABEL[context]
  const resolvedHint = hint ?? OWNERSHIP_PERCENT_HINT[context]

  return (
    <label className={`block min-w-0 ${className}`} htmlFor={id}>
      <div className="flex flex-wrap items-center gap-2">
        <CadastroFieldLabel required={required}>{resolvedLabel}</CadastroFieldLabel>
        {showBadge ? (
          <Badge variant="statusCompact" tone="brand1" label="Próprio" title="100% na sua conta — mesmo efeito de lançamento sem compartilhamento" />
        ) : null}
      </div>
      <div className="relative mt-0.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          className={`${cadastroFieldCls} pr-8 text-right tabular-nums disabled:opacity-50 ${inputClassName}`}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          %
        </span>
      </div>
      {!compact && resolvedHint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{resolvedHint}</p>
      ) : null}
    </label>
  )
}
