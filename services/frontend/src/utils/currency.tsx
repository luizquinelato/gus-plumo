/**
 * Utilitários para formatação de moeda
 */

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

