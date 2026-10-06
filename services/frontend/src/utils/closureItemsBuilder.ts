export function buildAllClosureItems(
  closureData: any,
  isPartnerView: boolean,
  accountScope: 'main' | 'partner' | 'all' = 'all',
) {
  const allItems: any[] = []
  const mainAccount = closureData?.main_account_card
  const partnerAccount = closureData?.partner_account_card
  const includeMain = accountScope === 'all' || accountScope === 'main'
  const includePartner = accountScope === 'all' || accountScope === 'partner'

  const addSourceToItems = (
    items: any[],
    source: string,
    ownerAccount: any,
    counterpartAccount: any,
    isFromPartner: boolean,
  ) =>
    (items || []).map((item) => {
      const sourceTable =
        item.source_table ||
        (source === 'Conta Bancária'
          ? 'bank_statements'
          : source === 'Cartão de Crédito'
            ? 'credit_card_invoices'
            : 'benefit_card_statements')
      return {
      ...item,
      source_table: sourceTable,
      _closure_key: `${ownerAccount?.account_id ?? 0}:${sourceTable}:${item.id ?? 0}`,
      source_type: source,
      owner_account: {
        name: ownerAccount?.account_name,
        number: ownerAccount?.account_number,
        bank: ownerAccount?.bank_name,
        agency: ownerAccount?.agency,
      },
      counterpart_account: {
        name: counterpartAccount?.account_name,
        number: counterpartAccount?.account_number,
        bank: counterpartAccount?.bank_name,
        agency: counterpartAccount?.agency,
      },
      should_invert: isPartnerView !== isFromPartner,
      }
    })

  if (mainAccount && includeMain) {
    allItems.push(...addSourceToItems(mainAccount.expense_items, 'Conta Bancária', mainAccount, partnerAccount, false))
    allItems.push(...addSourceToItems(mainAccount.revenue_items, 'Conta Bancária', mainAccount, partnerAccount, false))
    allItems.push(...addSourceToItems(mainAccount.credit_card_expense_items, 'Cartão de Crédito', mainAccount, partnerAccount, false))
    allItems.push(...addSourceToItems(mainAccount.credit_card_revenue_items, 'Cartão de Crédito', mainAccount, partnerAccount, false))
    allItems.push(...addSourceToItems(mainAccount.benefit_card_expense_items, 'Cartão Benefício', mainAccount, partnerAccount, false))
    allItems.push(...addSourceToItems(mainAccount.benefit_card_revenue_items, 'Cartão Benefício', mainAccount, partnerAccount, false))
  }

  if (partnerAccount && includePartner) {
    allItems.push(...addSourceToItems(partnerAccount.expense_items, 'Conta Bancária', partnerAccount, mainAccount, true))
    allItems.push(...addSourceToItems(partnerAccount.revenue_items, 'Conta Bancária', partnerAccount, mainAccount, true))
    allItems.push(...addSourceToItems(partnerAccount.credit_card_expense_items, 'Cartão de Crédito', partnerAccount, mainAccount, true))
    allItems.push(...addSourceToItems(partnerAccount.credit_card_revenue_items, 'Cartão de Crédito', partnerAccount, mainAccount, true))
    allItems.push(...addSourceToItems(partnerAccount.benefit_card_expense_items, 'Cartão Benefício', partnerAccount, mainAccount, true))
    allItems.push(...addSourceToItems(partnerAccount.benefit_card_revenue_items, 'Cartão Benefício', partnerAccount, mainAccount, true))
  }

  allItems.sort((left, right) => {
    const byDate = String(right.date || '').localeCompare(String(left.date || ''))
    if (byDate !== 0) return byDate
    return String(right.id ?? '').localeCompare(String(left.id ?? ''), undefined, { numeric: true })
  })

  return allItems
}

export function closureItemMatchKey(item: {
  id?: number
  source_table?: string
  owner_account?: { name?: string }
  source_type?: string
}, ownerAccountId?: number) {
  const source =
    item.source_table ||
    (item.source_type === 'Conta Bancária'
      ? 'bank_statements'
      : item.source_type === 'Cartão de Crédito'
        ? 'credit_card_invoices'
        : item.source_type === 'Cartão Benefício'
          ? 'benefit_card_statements'
          : 'bank_statements')
  return `${ownerAccountId ?? 0}:${source}:${item.id ?? 0}`
}
