/** Busca por descrição: substring ou regex (auto-detect como na Curadoria). */

export type DescriptionSearchMode = 'pattern' | 'regex'

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/

export function getDescriptionSearchMode(searchTerm: string): DescriptionSearchMode {
  const trimmed = searchTerm.trim()
  if (!trimmed) return 'pattern'
  return REGEX_SPECIAL_CHARS.test(searchTerm) ? 'regex' : 'pattern'
}

export function validateDescriptionSearchRegex(searchTerm: string): string | null {
  if (getDescriptionSearchMode(searchTerm) !== 'regex') return null
  try {
    new RegExp(searchTerm, 'i')
    return null
  } catch (e: unknown) {
    return e instanceof Error ? e.message : 'Regex inválido'
  }
}

export function descriptionMatchesSearch(description: string, searchTerm: string): boolean {
  const term = searchTerm.trim()
  if (!term) return true

  if (getDescriptionSearchMode(term) === 'pattern') {
    return description.toLowerCase().includes(term.toLowerCase())
  }

  try {
    return new RegExp(term, 'i').test(description)
  } catch {
    return false
  }
}

export function resolveDescriptionSearchState(searchTerm: string): {
  mode: DescriptionSearchMode
  regexError: string | null
} {
  const trimmed = searchTerm.trim()
  if (!trimmed) {
    return { mode: 'pattern', regexError: null }
  }
  const mode = getDescriptionSearchMode(searchTerm)
  return {
    mode,
    regexError: mode === 'regex' ? validateDescriptionSearchRegex(searchTerm) : null,
  }
}

/** Filtro Curadoria / listas: início da descrição (0–9 ou A–Z). */
export const DESCRIPTION_START_FILTER_DIGITS = '0-9' as const

export const DESCRIPTION_START_FILTER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function normalizeDescriptionStartChar(description: string): string | null {
  const trimmed = description.trim()
  if (!trimmed) return null
  const first = trimmed.charAt(0)
  if (/\d/.test(first)) return DESCRIPTION_START_FILTER_DIGITS
  const letter = first
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  if (/[A-Z]/.test(letter)) return letter
  return null
}

export function descriptionMatchesStartFilter(description: string, filter: string | null): boolean {
  if (!filter) return true
  const key = normalizeDescriptionStartChar(description)
  if (!key) return false
  return key === filter
}
