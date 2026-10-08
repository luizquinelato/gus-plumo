import * as XLSX from 'xlsx'
import { formatAccountNumberForExcel, formatAgencyForExcel } from './cadastroExcelBankFields'

function jsonToSheetTextColumns(rows: Record<string, unknown>[], textKeys: string[]) {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (!rows.length || !textKeys.length || !ws['!ref']) return ws
  const headers = Object.keys(rows[0])
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (const key of textKeys) {
    const col = headers.indexOf(key)
    if (col < 0) continue
    for (let r = 1; r <= range.e.r; r++) {
      const raw = rows[r - 1][key]
      if (raw === '' || raw == null) continue
      const addr = XLSX.utils.encode_cell({ r, c: col })
      ws[addr] = { t: 's', v: String(raw) }
    }
  }
  return ws
}

function bookWithMeta(
  sheetName: string,
  rows: Record<string, unknown>[],
  meta: Record<string, string>,
  filename: string,
  textColumnKeys: string[] = [],
) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, jsonToSheetTextColumns(rows, textColumnKeys), sheetName)
  const metaRows = Object.entries(meta).map(([Campo, Valor]) => ({ Campo, Valor }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), 'Info')
  XLSX.writeFile(wb, filename)
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
  const now = new Date()
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
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tagRows), 'Tags')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(subRows), 'Subtags')
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `tags_subtags_${dateStr}.xlsx`)
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
  bookWithMeta(
    'Contas',
    rows,
    { Gerado: now.toLocaleString('pt-BR'), Total: String(rows.length) },
    `contas_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`,
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
  bookWithMeta(
    'Compartilhamentos',
    rows,
    { Gerado: now.getFullYear().toString(), Total: String(rows.length) },
    `compartilhamentos_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`,
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
      c.expense_sharing?.shared_account?.description ??
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
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupRows), 'Grupos')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cardRows), 'Cartões')
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `cartoes_${dateStr}.xlsx`)
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
          it.expense_sharing?.shared_account?.description ??
          '',
        'Parte (%)': it.ownership_percentage,
        Ordem: it.display_order,
      })
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tplRows), 'Templates')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), 'Itens')
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `templates_${dateStr}.xlsx`)
}
