import { formatAccountNumberForExcel, formatAgencyForExcel } from './cadastroExcelBankFields'
import {
  downloadExcelSafe,
  excelDateStamp,
  type ExcelColumnKind,
  type ExcelRow,
} from './excelExportClient'

const textKinds = (keys: string[]): Record<string, ExcelColumnKind> =>
  Object.fromEntries(keys.map((k) => [k, 'text' as const]))

function bookWithMeta(
  sheetName: string,
  rows: ExcelRow[],
  meta: Record<string, string>,
  filename: string,
  textColumnKeys: string[] = [],
) {
  const metaRows = Object.entries(meta).map(([Campo, Valor]) => ({ Campo, Valor }))
  return downloadExcelSafe(filename, [
    { name: sheetName, rows, kinds: textKinds(textColumnKeys) },
    { name: 'Info', rows: metaRows, kinds: { Valor: 'text' } },
  ])
}

const simNao = (v: boolean) => (v ? 'Sim' : 'Não')

export interface TagExportRow {
  id: number
  name: string
  description: string | null
  icon: string | null
}

export interface SubtagExportRow {
  id: number
  tag_id: number
  tag_name: string | null
  name: string
  description: string | null
  type: string
  icon: string | null
}

export function exportTagsSubtagsToExcel(tags: TagExportRow[], subtags: SubtagExportRow[]) {
  const tagRows = tags.map((t) => ({
    ID: t.id,
    Nome: t.name,
    Descrição: t.description ?? '',
    Ícone: t.icon ?? '',
  }))
  const subRows = subtags.map((s) => ({
    ID: s.id,
    'ID Tag': s.tag_id,
    Tag: s.tag_name ?? '',
    Nome: s.name,
    Descrição: s.description ?? '',
    Tipo: s.type === 'receita' ? 'Receita' : 'Despesa',
    Ícone: s.icon ?? '',
  }))
  return downloadExcelSafe(`tags_subtags_${excelDateStamp()}.xlsx`, [
    { name: 'Tags', rows: tagRows, kinds: { ID: 'int' } },
    { name: 'Subtags', rows: subRows, kinds: { ID: 'int', 'ID Tag': 'int' } },
  ])
}

export function exportContasToExcel(
  contas: Array<{
    id: number
    name?: string
    description?: string
    account_type?: string
    bank?: { code: string; name: string }
    agency?: number
    account_number?: number
    active: boolean
  }>,
) {
  const now = new Date()
  const rows = contas.map((c) => ({
    ID: c.id,
    Nome: c.name ?? '',
    Descrição: c.description ?? '',
    Tipo: c.account_type ?? '',
    'Banco (código)': c.bank?.code ?? '',
    Agência: formatAgencyForExcel(c.agency),
    Conta: formatAccountNumberForExcel(c.account_number),
    Ativo: simNao(c.active),
  }))
  return bookWithMeta(
    'Contas',
    rows,
    { Gerado: now.toLocaleString('pt-BR'), Total: String(rows.length) },
    `contas_${excelDateStamp(now)}.xlsx`,
    ['Agência', 'Conta'],
  )
}

export function exportCompartilhamentosToExcel(
  items: Array<{
    id: number
    shared_account_id?: number
    shared_account?: {
      id?: number
      name?: string
      bank?: { code: string }
      agency?: string | number
      account_number?: string | number
    } | null
    my_contribution_percentage: number
    revenue_contribution_percentage?: number
    description?: string
    active: boolean
    is_inverse?: boolean
  }>,
) {
  const direct = items.filter((i) => !i.is_inverse)
  const now = new Date()
  const rows = direct.map((c) => ({
    ID: c.id,
    'ID Conta parceira': c.shared_account_id ?? c.shared_account?.id ?? '',
    'Conta parceira': c.shared_account?.name ?? '',
    'Banco (código)': c.shared_account?.bank?.code ?? '',
    Agência: formatAgencyForExcel(c.shared_account?.agency),
    Conta: formatAccountNumberForExcel(c.shared_account?.account_number),
    'Contribuição despesa (%)': c.my_contribution_percentage,
    'Contribuição receita (%)': c.revenue_contribution_percentage ?? '',
    Descrição: c.description ?? '',
    Ativo: simNao(c.active),
  }))
  return bookWithMeta(
    'Compartilhamentos',
    rows,
    { Gerado: now.getFullYear().toString(), Total: String(rows.length) },
    `compartilhamentos_${excelDateStamp(now)}.xlsx`,
    ['Agência', 'Conta'],
  )
}

export function exportCartoesToExcel(
  cartoes: Array<{
    id: number
    name: string
    description?: string
    number: string
    type: string
    closing_day?: number
    due_day?: number
    invoice_group_id?: number | null
    invoice_group_name?: string | null
    expense_sharing_id?: number | null
    expense_sharing?: { id?: number; shared_account?: { name?: string } } | null
    expense_ownership_percentage?: number | null
    revenue_ownership_percentage?: number | null
    active: boolean
  }>,
  groups: Array<{ id: number; name: string; closing_day: number; due_day: number; active: boolean }>,
  /** Lista completa (sem filtro de aba) para montar IDs cartões na aba Grupos */
  allCartoesForGroupLink?: typeof cartoes,
) {
  const now = new Date()
  const isCredito = (t: string) => t === 'credito' || t === 'crédito'
  const linkSource = allCartoesForGroupLink ?? cartoes

  const cardRows = cartoes.map((c) => ({
    ID: c.id,
    Nome: c.name,
    Descrição: c.description ?? '',
    Final: c.number,
    Tipo: c.type === 'beneficios' ? 'Benefícios' : 'Crédito',
    'ID Grupo': c.invoice_group_id ?? '',
    Grupo: c.invoice_group_name ?? '',
    Fechamento: c.closing_day ?? '',
    Vencimento: c.due_day ?? '',
    'ID Compartilhamento': c.expense_sharing_id ?? c.expense_sharing?.id ?? '',
    'Conta parceira':
      c.expense_sharing?.shared_account?.name ??
      (c.expense_sharing?.shared_account as { description?: string } | undefined)?.description ??
      '',
    'Parte despesa (%)': c.expense_ownership_percentage ?? '',
    'Parte receita (%)': c.revenue_ownership_percentage ?? '',
    Ativo: simNao(c.active),
  }))

  const groupRows = groups.map((g) => {
    const members = linkSource.filter((c) => isCredito(c.type) && c.invoice_group_id === g.id)
    return {
      ID: g.id,
      Nome: g.name,
      Fechamento: g.closing_day,
      Vencimento: g.due_day,
      'IDs cartões': members.map((m) => m.id).join(', '),
      Cartões: members.map((m) => `${m.name} · ${m.number}`).join('; '),
      Ativo: simNao(g.active),
    }
  })
  return downloadExcelSafe(`cartoes_${excelDateStamp(now)}.xlsx`, [
    { name: 'Grupos', rows: groupRows },
    { name: 'Cartões', rows: cardRows },
  ])
}

export function exportTemplatesToExcel(
  templates: Array<{
    id: number
    name: string
    description: string | null
    icon: string
    active: boolean
    items: Array<{
      id: number
      description: string
      amount: number | null
      day_of_month: number | null
      subtag?: { tag_name?: string | null; name: string; type: string } | null
      ownership_percentage: number
      expense_sharing_id?: number | null
    expense_sharing?: { id?: number; shared_account?: { name?: string } } | null
      display_order: number
    }>
  }>,
) {
  const now = new Date()
  const tplRows = templates.map((t) => ({
    ID: t.id,
    Nome: t.name,
    Descrição: t.description ?? '',
    Ícone: t.icon,
    Ativo: simNao(t.active),
  }))
  const itemRows: Record<string, unknown>[] = []
  for (const t of templates) {
    for (const it of t.items) {
      itemRows.push({
        'ID Template': t.id,
        'ID Item': it.id,
        'Nome template': t.name,
        Descrição: it.description,
        Valor: it.amount ?? '',
        Dia: it.day_of_month ?? '',
        Tag: it.subtag?.tag_name ?? '',
        Subtag: it.subtag?.name ?? '',
        Tipo: it.subtag?.type === 'receita' ? 'Receita' : it.subtag?.type === 'despesa' ? 'Despesa' : '',
        'Conta parceira':
          it.expense_sharing?.shared_account?.name ??
          (it.expense_sharing?.shared_account as { description?: string } | undefined)?.description ??
          '',
        'Parte (%)': it.ownership_percentage,
        Ordem: it.display_order,
      })
    }
  }
  return downloadExcelSafe(`templates_${excelDateStamp(now)}.xlsx`, [
    { name: 'Templates', rows: tplRows },
    { name: 'Itens', rows: itemRows as ExcelRow[], kinds: { Valor: 'money' } },
  ])
}
