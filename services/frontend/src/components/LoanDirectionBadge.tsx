/** Mesmo visual das listas de empréstimo / liquidações no balanço. */
export default function LoanDirectionBadge({
  receive,
  className = '',
  size = 'md',
}: {
  /** true = A receber (verde), false = A pagar (vermelho) */
  receive: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  const sizeCls =
    size === 'sm'
      ? 'rounded px-2 py-0.5 text-[10px]'
      : 'rounded px-3 py-1 text-xs font-medium w-[88px] justify-center'
  return (
    <span
      className={`inline-flex items-center font-semibold text-white ${receive ? 'bg-green-600' : 'bg-red-600'} ${sizeCls} ${className}`}
    >
      {receive ? 'A receber' : 'A pagar'}
    </span>
  )
}
