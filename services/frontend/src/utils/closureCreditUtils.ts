/** Helpers para crédito gerado por pagamento a maior na quitação do fechamento. */

export interface ClosureLoanPaymentEntry {
  loan_id?: number
  loan_type?: 'lent' | 'borrowed'
  description?: string
  original_amount?: number
  remaining_before?: number
  remaining_after?: number
  generated_on_settlement?: boolean
  balance_closure_payment_id?: number
}

export function getSettlementCreditEntries(
  closure: { closure_data?: { loan_payments?: ClosureLoanPaymentEntry[] } }
): ClosureLoanPaymentEntry[] {
  return (closure.closure_data?.loan_payments || []).filter(lp => lp.generated_on_settlement)
}

export function getSettlementCreditForPayment(
  closure: { closure_data?: { loan_payments?: ClosureLoanPaymentEntry[] } },
  paymentId: number
): ClosureLoanPaymentEntry | undefined {
  return getSettlementCreditEntries(closure).find(
    lp => Number(lp.balance_closure_payment_id) === paymentId
  )
}

export function getSettlementCreditTotal(
  closure: { closure_data?: { loan_payments?: ClosureLoanPaymentEntry[] } }
): number {
  return getSettlementCreditEntries(closure).reduce(
    (sum, lp) => sum + Math.abs(Number(lp.original_amount ?? lp.remaining_after ?? 0)),
    0
  )
}

/** Mandante (quem criou o fechamento) vê saldo negativo; contraparte vê positivo. */
export function getSettlementCreditSignedForViewer(
  closure: { closure_data?: { loan_payments?: ClosureLoanPaymentEntry[] }; account_id?: number },
  isMandanteViewer: boolean
): number {
  const total = getSettlementCreditTotal(closure)
  if (total <= 0.01) return 0
  return isMandanteViewer ? -total : total
}

export function filterRegularLoanPayments<T extends { generated_on_settlement?: boolean }>(
  loans: T[] | undefined | null
): T[] {
  return (loans || []).filter(lp => !lp.generated_on_settlement)
}

/** Valores com sinal na perspectiva do tipo (lent / borrowed). */
export function signedLoanFieldValue(
  rawValue: number,
  isLent: boolean,
  field: 'principal' | 'corrected' | 'paid' | 'remaining'
): number {
  const abs = Math.abs(rawValue)
  if (field === 'paid') {
    return isLent ? abs : -abs
  }
  if (field === 'remaining') {
    return isLent ? abs : -abs
  }
  // principal / corrected
  return isLent ? -abs : abs
}
