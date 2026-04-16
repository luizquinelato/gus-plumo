/**
 * Utilitário para formatação consistente de contas em toda a aplicação
 * Usa bullet points (•) como separador padrão
 */

interface Bank {
  id?: number
  code?: string
  name?: string
  full_name?: string
}

interface Account {
  id: number
  name?: string | null
  description?: string | null
  bank?: Bank | null
  agency?: string | number | null
  account_number?: string | number | null
}

/**
 * Formata agência com dígito verificador
 * Exemplo: 1 -> "00001-0"
 */
export const formatAgency = (agency: string | number | null | undefined): string => {
  if (!agency) return ''
  const agencyStr = String(agency).padStart(5, '0')
  return `${agencyStr}-0`
}

/**
 * Formata número de conta com dígito verificador
 * Exemplo: 12345 -> "000012345-6"
 */
export const formatAccount = (accountNumber: string | number | null | undefined): string => {
  if (!accountNumber) return ''
  const accountStr = String(accountNumber).padStart(9, '0')
  return `${accountStr}-6`
}

/**
 * Formata informações completas da conta para exibição em dropdowns
 * Formato: Nome • Banco • Agência • Conta
 * 
 * @param account - Objeto da conta com informações
 * @param options - Opções de formatação
 * @returns String formatada com bullet points
 * 
 * @example
 * formatAccountDisplay(account)
 * // "Polezel • 208 - BTG Pactual • Ag: 00001-0 • Conta: 000012345-6"
 */
export const formatAccountDisplay = (
  account?: Account | null,
  options?: {
    includeDescription?: boolean  // Se true, inclui description após o nome
    shortBank?: boolean           // Se true, usa apenas código do banco
  }
): string => {
  if (!account) return 'N/A'

  const parts: string[] = []

  // 1. Nome da conta (sempre primeiro)
  if (account.name) {
    parts.push(account.name)
  }

  // 2. Descrição (opcional, se includeDescription = true)
  if (options?.includeDescription && account.description) {
    parts.push(account.description)
  }

  // 3. Banco
  if (account.bank) {
    if (options?.shortBank) {
      // Apenas código
      parts.push(account.bank.code || account.bank.name || '')
    } else {
      // Código - Nome
      const bankParts = []
      if (account.bank.code) bankParts.push(account.bank.code)
      if (account.bank.name) bankParts.push(account.bank.name)
      if (bankParts.length > 0) {
        parts.push(bankParts.join(' - '))
      }
    }
  }

  // 4. Agência
  if (account.agency) {
    parts.push(`Ag: ${formatAgency(account.agency)}`)
  }

  // 5. Conta
  if (account.account_number) {
    parts.push(`Conta: ${formatAccount(account.account_number)}`)
  }

  // Se não tiver nenhuma informação, retorna ID
  if (parts.length === 0) {
    return `Conta #${account.id}`
  }

  // Junta tudo com bullet points
  return parts.join(' • ')
}

/**
 * Formata conta compartilhada com percentual de contribuição
 * Formato: Nome • Banco • Agência • Conta (XX%)
 * 
 * @param account - Objeto da conta
 * @param percentage - Percentual de contribuição
 * @returns String formatada com percentual
 * 
 * @example
 * formatSharedAccountDisplay(account, 50)
 * // "Polezel • 208 - BTG Pactual • Ag: 00001-0 • Conta: 000012345-6 (50%)"
 */
export const formatSharedAccountDisplay = (
  account?: Account | null,
  percentage?: number
): string => {
  const baseFormat = formatAccountDisplay(account)
  
  if (percentage !== undefined && percentage !== null) {
    return `${baseFormat} (${percentage}%)`
  }
  
  return baseFormat
}

/**
 * Formata conta de forma compacta (sem formatação de agência/conta)
 * Formato: Nome • Banco
 * 
 * @param account - Objeto da conta
 * @returns String formatada compacta
 * 
 * @example
 * formatAccountCompact(account)
 * // "Polezel • BTG Pactual"
 */
export const formatAccountCompact = (account?: Account | null): string => {
  if (!account) return 'N/A'

  const parts: string[] = []

  if (account.name) {
    parts.push(account.name)
  }

  if (account.bank?.name) {
    parts.push(account.bank.name)
  }

  if (parts.length === 0) {
    return `Conta #${account.id}`
  }

  return parts.join(' • ')
}

