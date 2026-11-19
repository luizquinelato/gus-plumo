import type { ProjectionSource } from '../components/ProjectionOriginBadge'

export type DescriptionLine = {
  id: number
  description: string
  source: ProjectionSource
}

function isManualForContaOverlap(source: ProjectionSource): boolean {
  return source === 'manual' || source === 'clone'
}

function isContaExtrato(source: ProjectionSource): boolean {
  return source === 'bank_statement'
}

function normalizeDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
}

function tokenSet(description: string): Set<string> {
  const norm = normalizeDescription(description)
  const tokens = norm.split(/[^a-z0-9à-ú]+/i).filter((t) => t.length >= 2)
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) {
    if (b.has(t)) inter += 1
  }
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function descriptionsSimilar(a: string, b: string): boolean {
  const na = normalizeDescription(a)
  const nb = normalizeDescription(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const minLen = Math.min(na.length, nb.length)
  const maxLen = Math.max(na.length, nb.length)
  if (minLen >= 6 && (na.includes(nb) || nb.includes(na))) return true
  if (maxLen >= 8 && minLen / maxLen >= 0.92 && na.slice(0, 8) === nb.slice(0, 8)) return true
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (ta.size >= 2 && tb.size >= 2) {
    return jaccard(ta, tb) >= 0.75
  }
  return false
}

/**
 * Lançamentos manual × conta (extrato) com descrição igual ou parecida.
 * Não cruza manual×manual nem conta×conta — foco em limpar manual duplicado do extrato.
 */
export function idsManualOverlappingConta(lines: DescriptionLine[]): Set<number> {
  const matched = new Set<number>()
  const manual = lines.filter((line) => isManualForContaOverlap(line.source))
  const conta = lines.filter((line) => isContaExtrato(line.source))
  if (manual.length === 0 || conta.length === 0) return matched

  for (const m of manual) {
    for (const c of conta) {
      if (descriptionsSimilar(m.description, c.description)) {
        matched.add(m.id)
        matched.add(c.id)
      }
    }
  }

  return matched
}