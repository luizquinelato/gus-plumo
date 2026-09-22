interface StatusSwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  labelOn?: string
  labelOff?: string
  showLabel?: boolean
  title?: string
}

/**
 * Toggle de soft-delete (active=true/false).
 * Switch → inativar/reativar; lixeira → exclusão definitiva.
 */
export default function StatusSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'sm',
  labelOn = 'Ativo',
  labelOff = 'Inativo',
  showLabel = false,
  title,
}: StatusSwitchProps) {
  const dims = size === 'sm'
    ? { w: 30, h: 16, knob: 12, pad: 2 }
    : { w: 38, h: 20, knob: 16, pad: 2 }
  const trackBg = checked ? 'var(--color-success)' : '#cbd5e1'

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? labelOn : labelOff}
      title={title ?? (showLabel ? undefined : (checked ? labelOn : labelOff))}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
      className={`relative inline-flex items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-1)] ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
      style={{ width: dims.w, height: dims.h, background: trackBg }}
    >
      <span
        className="absolute rounded-full bg-white shadow-sm transition-transform"
        style={{
          width: dims.knob,
          height: dims.knob,
          top: dims.pad,
          left: dims.pad,
          transform: checked ? `translateX(${dims.w - dims.knob - dims.pad * 2}px)` : 'translateX(0)',
        }}
      />
    </button>
  )

  if (!showLabel) return toggle

  return (
    <div className="inline-flex items-center gap-1.5">
      {toggle}
      <span
        className={`whitespace-nowrap text-xs font-medium ${
          checked ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        {checked ? labelOn : labelOff}
      </span>
    </div>
  )
}
