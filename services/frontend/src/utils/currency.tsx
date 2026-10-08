/**
 * Utilitários para formatação de moeda
 */

/**
 * Converte texto pt-BR (10.000,00), en-US (10,000.00) ou decimal simples (10000.00) em número.
 */
export function parseLocaleAmount(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value

  const text = String(value).trim()
  if (!text) return null

  const hasComma = text.includes(',')
  const hasDot = text.includes('.')
  let normalized: string

  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      normalized = text.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = text.replace(/,/g, '')
    }
  } else if (hasComma) {
    normalized = text.replace(/\./g, '').replace(',', '.')
  } else if (hasDot) {
    const parts = text.split('.')
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = text
    } else {
      normalized = text.replace(/\./g, '')
    }
  } else {
    normalized = text
  }

  const n = parseFloat(normalized)
  return Number.isNaN(n) ? null : n
}

/**
 * Formata um valor numérico como moeda brasileira (BRL)
 */
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

/**
 * Formata moeda com cor (verde para positivo, vermelho para negativo)
 * @param value - Valor a ser formatado
 * @param hideNegativeSign - Se true, remove o sinal negativo (mas mantém a cor vermelha)
 * @returns JSX com o valor formatado e colorido
 */
export const MASKED_CURRENCY = '••••••'

/**
 * Formata moeda ou retorna máscara quando valores estão ocultos
 */
export const formatCurrencySafe = (value: number, hidden: boolean): string => {
  if (hidden) return MASKED_CURRENCY
  return formatCurrency(value)
}

/**
 * Formata moeda com cor ou retorna máscara neutra quando oculto
 */
export const formatCurrencyWithColorSafe = (
  value: number,
  hidden: boolean,
  hideNegativeSign: boolean = false
): JSX.Element => {
  if (hidden) {
    return <span className="text-gray-400 dark:text-gray-500 tracking-widest">{MASKED_CURRENCY}</span>
  }
  return formatCurrencyWithColor(value, hideNegativeSign)
}

/**
 * Formata moeda com sinal prefixado (ex.: faturas negativas) respeitando ocultação
 */
export const formatSignedCurrencySafe = (
  value: number,
  hidden: boolean,
  options?: { forceNegative?: boolean; colorClass?: string }
): JSX.Element => {
  if (hidden) {
    return <span className="text-gray-400 dark:text-gray-500 tracking-widest">{MASKED_CURRENCY}</span>
  }

  const absFormatted = formatCurrency(Math.abs(value))
  const prefix = options?.forceNegative || value < 0 ? '-' : ''
  const colorClass = options?.colorClass ?? (
    (options?.forceNegative || value < 0)
      ? 'text-red-600 dark:text-red-400'
      : value > 0
        ? 'text-green-600 dark:text-green-400'
        : ''
  )

  return <span className={`font-bold ${colorClass}`}>{prefix}{absFormatted}</span>
}

export const formatCurrencyWithColor = (
  value: number,
  hideNegativeSign: boolean = false
): JSX.Element => {
  const isNegative = value < 0
  const isPositive = value > 0
  const displayValue = hideNegativeSign && isNegative ? Math.abs(value) : value
  const formatted = formatCurrency(displayValue)

  const colorClass = isNegative
    ? 'text-red-600 dark:text-red-400'
    : isPositive
      ? 'text-green-600 dark:text-green-400'
      : ''

  return (
    <span className={colorClass}>
      {formatted}
    </span>
  )
}

