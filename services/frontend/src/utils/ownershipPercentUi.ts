/** Percentual gravado no lançamento ou default de importação/mapeamento. */

export type OwnershipPercentContext =
  | 'transaction'
  | 'cardImportExpense'
  | 'cardImportRevenue'
  | 'sharingDefaultExpense'
  | 'sharingDefaultRevenue'
  | 'mappingExpense'
  | 'mappingRevenue'

export const OWNERSHIP_PERCENT_LABEL: Record<OwnershipPercentContext, string> = {
  transaction:
    'Parte na sua conta (%)',
  cardImportExpense:
    'Despesa na importação — sua conta (%)',
  cardImportRevenue:
    'Receita na importação — sua conta (%)',
  sharingDefaultExpense:
    'Despesa — padrão na sua conta (%)',
  sharingDefaultRevenue:
    'Receita — padrão na sua conta (%)',
  mappingExpense:
    'Despesa no mapeamento — sua conta (%)',
  mappingRevenue:
    'Receita no mapeamento — sua conta (%)',
}

export const OWNERSHIP_PERCENT_HINT: Record<OwnershipPercentContext, string> = {
  transaction:
    'Quanto do valor entra no fechamento da sua conta; o restante vai para o parceiro. Sem compartilhamento ou 100% = aba Próprio.',
  cardImportExpense:
    'Ao importar faturas, quanto da despesa fica na sua conta. 0% = cartão gerenciado (só organização).',
  cardImportRevenue:
    'Ao importar faturas, quanto do estorno/receita fica na sua conta.',
  sharingDefaultExpense:
    'Default para novos lançamentos de despesa neste compartilhamento. 100% = tratado como próprio no fechamento.',
  sharingDefaultRevenue:
    'Default para receitas neste compartilhamento. 100% = tratado como próprio no fechamento.',
  mappingExpense:
    'Ao aplicar o mapeamento em despesas, quanto fica na sua conta.',
  mappingRevenue:
    'Ao aplicar o mapeamento em receitas, quanto fica na sua conta.',
}

export function parseOwnershipPercent(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** 100% (ou vazio/null com default implícito 100) = equivalente a lançamento próprio no fechamento. */
export function isProprioOwnershipPercent(value: string | number | null | undefined): boolean {
  const n = parseOwnershipPercent(value)
  if (n === null) return true
  return n >= 100
}
