import * as XLSX from 'xlsx'
import { parseAccountNumberFromExcel, parseAgencyFromExcel } from './cadastroExcelBankFields'

function sheetJson(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
}

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function numId(v: unknown): number | null {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

function parseSim(v: unknown): boolean {
  return ['sim', 's', '1', 'true', 'yes'].includes(str(v).toLowerCase())
}

function parseIdList(v: unknown): number[] {
  const text = str(v)
  if (!text) return []
  return text
    .split(/[,;]/)
    .map((part) => parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n))
}

export async function parseTagsSubtagsWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const tags = sheetJson(wb, 'Tags').map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    name: str(row.Nome),
    description: str(row.Descrição) || null,
    icon: str(row.Ícone) || null,
  }))
  const tagNameById = new Map<number, string>()
  for (const row of sheetJson(wb, 'Tags')) {
    const id = numId(row.ID)
    const name = str(row.Nome)
    if (id != null && name) tagNameById.set(id, name)
  }
  const subtags = sheetJson(wb, 'Subtags').map((row, i) => {
    const tagId = numId(row['ID Tag'])
    let tagName = str(row.Tag)
    if (!tagName && tagId != null) tagName = tagNameById.get(tagId) ?? ''
    return {
      row_index: i + 2,
      id: numId(row.ID),
      tag_id: tagId,
      tag_name: tagName,
      name: str(row.Nome),
      description: str(row.Descrição) || null,
      type: str(row.Tipo),
      icon: str(row.Ícone) || null,
    }
  })
  if (!tags.length && !subtags.length) throw new Error('Abas Tags/Subtags não encontradas ou vazias.')
  return { tags, subtags }
}

export async function parseContasWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  let rows = sheetJson(wb, 'Contas')
  if (!rows.length && wb.SheetNames[0]) rows = sheetJson(wb, wb.SheetNames[0])
  const contas = rows.map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    name: str(row.Nome),
    description: str(row.Descrição) || null,
    account_type: str(row.Tipo) || null,
    bank_code: str(row['Banco (código)']),
    agency: parseAgencyFromExcel(row.Agência),
    account_number: parseAccountNumberFromExcel(row.Conta),
    active: row.Ativo === '' ? true : parseSim(row.Ativo),
  }))
  if (!contas.length) throw new Error('Nenhuma conta na planilha.')
  return { rows: contas }
}

export async function parseCompartilhamentosWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  let rows = sheetJson(wb, 'Compartilhamentos')
  if (!rows.length && wb.SheetNames[0]) rows = sheetJson(wb, wb.SheetNames[0])
  const items = rows.map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    shared_account_id: numId(row['ID Conta parceira']),
    partner_name: str(row['Conta parceira']),
    bank_code: str(row['Banco (código)']),
    agency: parseAgencyFromExcel(row.Agência),
    account_number: parseAccountNumberFromExcel(row.Conta),
    my_contribution_percentage: row['Contribuição despesa (%)'] === '' ? null : Number(row['Contribuição despesa (%)']),
    revenue_contribution_percentage:
      row['Contribuição receita (%)'] === '' ? null : Number(row['Contribuição receita (%)']),
    description: str(row.Descrição) || null,
    active: row.Ativo === '' ? true : parseSim(row.Ativo),
  }))
  if (!items.length) throw new Error('Nenhum compartilhamento na planilha.')
  return { rows: items }
}

export async function parseCartoesWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const groups = sheetJson(wb, 'Grupos').map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    name: str(row.Nome),
    closing_day: row.Fechamento === '' ? 14 : Number(row.Fechamento),
    due_day: row.Vencimento === '' ? 14 : Number(row.Vencimento),
    card_ids: parseIdList(row['IDs cartões']),
    active: row.Ativo === '' ? true : parseSim(row.Ativo),
  }))
  const cards = sheetJson(wb, 'Cartões').map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    name: str(row.Nome),
    description: str(row.Descrição) || null,
    number: str(row.Final),
    type: str(row.Tipo),
    closing_day: row.Fechamento === '' ? null : Number(row.Fechamento),
    due_day: row.Vencimento === '' ? null : Number(row.Vencimento),
    group_id: numId(row['ID Grupo']),
    group_name: str(row.Grupo) || null,
    expense_sharing_id: numId(row['ID Compartilhamento']),
    partner_name: str(row['Conta parceira']) || null,
    expense_ownership_percentage:
      row['Parte despesa (%)'] === '' ? null : Number(row['Parte despesa (%)']),
    revenue_ownership_percentage:
      row['Parte receita (%)'] === '' ? null : Number(row['Parte receita (%)']),
    active: row.Ativo === '' ? true : parseSim(row.Ativo),
  }))
  if (!cards.length && !groups.length) throw new Error('Abas Cartões/Grupos não encontradas ou vazias.')
  return { groups, cards }
}

export async function parseTemplatesWorkbook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const templates = sheetJson(wb, 'Templates').map((row, i) => ({
    row_index: i + 2,
    id: numId(row.ID),
    name: str(row.Nome),
    description: str(row.Descrição) || null,
    icon: str(row.Ícone) || 'FileText',
    active: row.Ativo === '' ? true : parseSim(row.Ativo),
  }))
  const items = sheetJson(wb, 'Itens').map((row, i) => ({
    row_index: i + 2,
    template_id: numId(row['ID Template']),
    template_name: str(row['Nome template']),
    item_id: numId(row['ID Item']),
    description: str(row.Descrição),
    amount: row.Valor === '' ? null : Number(row.Valor),
    day_of_month: row.Dia === '' ? null : Number(row.Dia),
    tag_name: str(row.Tag),
    subtag_name: str(row.Subtag),
    subtag_type: str(row.Tipo),
    partner_name: str(row['Conta parceira']) || null,
    ownership_percentage: row['Parte (%)'] === '' ? 100 : Number(row['Parte (%)']),
    display_order: row.Ordem === '' ? 0 : Number(row.Ordem),
  }))
  if (!templates.length && !items.length) throw new Error('Abas Templates/Itens não encontradas ou vazias.')
  return { templates, items }
}
