/**
 * Máscara de percentual 0–100 com até 2 casas decimais (aceita vírgula ou ponto).
 * Retorna string normalizada com ponto como separador; valores acima de 100 viram '100'.
 */
export function maskPercentInput(raw: string): string {
  const normalized = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const dotIndex = normalized.indexOf('.')
  const intDigits = (dotIndex === -1 ? normalized : normalized.slice(0, dotIndex))
    .replace(/^0+(?=\d)/, '')
    .slice(0, 3)

  let value = intDigits
  if (dotIndex !== -1) {
    const decimals = normalized.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
    value = `${intDigits || '0'}.${decimals}`
  }

  return parseFloat(value) > 100 ? '100' : value
}

/** Remove separador decimal pendente ao sair do campo (ex.: '50.' → '50'). */
export function finalizePercentInput(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value
}

export function samePercent(a: string, b: string): boolean {
  if (a === '' || b === '') return a === b
  return parseFloat(a) === parseFloat(b)
}
