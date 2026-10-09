export type BenefitCardForMatch = {
  id: number
  name: string
  number: string
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Letras e dígitos, minúsculas — para comparar nome do arquivo com cadastro. */
export function normalizeForBenefitFileMatch(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function fileNameStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/i, '')
}

type ScoredCard = { id: number; score: number }

/**
 * Infere o cartão de benefícios a partir do nome do arquivo (últimos 4 dígitos, nome, tokens).
 * Retorna undefined se não houver match confiável ou houver empate.
 */
export function matchBenefitCardIdFromFileName(
  fileName: string,
  cards: BenefitCardForMatch[],
): number | undefined {
  if (cards.length === 0) return undefined

  const stem = fileNameStem(fileName)
  const normalizedStem = normalizeForBenefitFileMatch(stem)
  const stemDigits = stem.replace(/\D/g, '')

  const scored: ScoredCard[] = []

  for (const card of cards) {
    let score = 0
    const normalizedName = normalizeForBenefitFileMatch(card.name)
    const cardDigits = (card.number || '').replace(/\D/g, '')

    if (cardDigits.length >= 4) {
      const last4 = cardDigits.slice(-4)
      if (stem.includes(last4) || stemDigits.includes(last4)) {
        score += 100
      }
    }

    if (normalizedName.length >= 3 && normalizedStem.includes(normalizedName)) {
      score += 40 + Math.min(normalizedName.length, 20)
    }

    const tokens = card.name
      .split(/\s+/)
      .map((part) => normalizeForBenefitFileMatch(part))
      .filter((token) => token.length >= 4)

    for (const token of tokens) {
      if (normalizedStem.includes(token)) {
        score += 8 + token.length
      }
    }

    if (score > 0) {
      scored.push({ id: card.id, score })
    }
  }

  if (scored.length === 0) return undefined

  scored.sort((a, b) => b.score - a.score)

  if (scored.length >= 2 && scored[0].score === scored[1].score) {
    return undefined
  }

  if (scored[0].score < 12) {
    return undefined
  }

  return scored[0].id
}
