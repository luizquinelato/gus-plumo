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
 * Formata data para exibição em português (DD/MM/YYYY)
 * @param date - Date object, string de data, ou timestamp
 * @returns String no formato DD/MM/YYYY (ex: "05/02/2026")
 */
export const formatDateBR = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date
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

