/**
 * Utilitários para manipulação de datas sem problemas de timezone
 * 
 * IMPORTANTE: Sempre use estas funções ao invés de toISOString() para evitar
 * conversão indesejada para UTC que pode mudar a data (especialmente após 21h no Brasil)
 */

/**
 * Converte Date para string no formato YYYY-MM-DD usando timezone local
 * @param date - Date object ou string de data
 * @returns String no formato YYYY-MM-DD (ex: "2026-02-05") ou string vazia se inválido
 */
export const dateToLocalString = (date: Date | string): string => {
  // Se já é uma string no formato YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS, extrair apenas a parte da data
  if (typeof date === 'string') {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`
    }
  }

  const d = typeof date === 'string' ? new Date(date) : date

  // Valida se a data é válida
  if (isNaN(d.getTime())) {
    return ''
  }

  // Garante que o ano tenha 4 dígitos (padStart para anos < 1000)
  const year = String(d.getFullYear()).padStart(4, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Retorna a data de hoje no formato YYYY-MM-DD usando timezone local
 * @returns String no formato YYYY-MM-DD (ex: "2026-02-05")
 */
export const getTodayLocalDate = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Converte Date para timestamp local no formato YYYY-MM-DD HH:MM:SS
 * @param date - Date object (opcional, padrão = agora)
 * @returns String no formato YYYY-MM-DD HH:MM:SS (ex: "2026-02-05 19:30:45")
 */
export const dateToLocalTimestamp = (date: Date = new Date()): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/**
 * Converte YYYY-MM-DD para Date local (sem conversão UTC)
 */
export const parseLocalDate = (dateStr: string): Date | null => {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10))
}

/**
 * Formata data para exibição em português (DD/MM/YYYY)
 * @param date - Date object, string de data, ou timestamp
 * @returns String no formato DD/MM/YYYY (ex: "05/02/2026")
 */
export const formatDateBR = (date: Date | string): string => {
  const d = typeof date === 'string'
    ? (parseLocalDate(date) ?? new Date(date))
    : date
  if (isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Formata timestamp para exibição em português (DD/MM/YYYY HH:MM:SS)
 * @param date - Date object, string de data, ou timestamp
 * @returns String no formato DD/MM/YYYY HH:MM:SS (ex: "05/02/2026 19:30:45")
 */
export const formatDateTimeBR = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
}

/**
 * Aplica máscara DD/MM/YYYY durante digitação (máx. 8 dígitos)
 */
export const formatDateInputMask = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * Converte string DD/MM/YYYY para Date local, ou null se inválida
 */
export const parseDateBR = (value: string): Date | null => {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null

  const day = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const year = parseInt(match[3], 10)

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/**
 * Verifica se a data está dentro do intervalo permitido (comparação por dia)
 */
export const isDateInRange = (date: Date, minDate?: Date | null, maxDate?: Date | null): boolean => {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  if (minDate) {
    const minStart = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()).getTime()
    if (dayStart < minStart) return false
  }

  if (maxDate) {
    const maxStart = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()).getTime()
    if (dayStart > maxStart) return false
  }

  return true
}

