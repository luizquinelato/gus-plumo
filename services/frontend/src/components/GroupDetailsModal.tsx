import { useState, useEffect, useMemo } from 'react'
import { ArrowUp, ArrowDown, ArrowUpCircle, ArrowDownCircle, Landmark, CreditCard, Gift, Calendar } from 'lucide-react'
import { formatCurrencyWithColor } from '../utils/currency'
import { listPageTableRowHoverCls, listPageTableSectionCls, listPageTableTdCls } from './CadastroListPageLayout'
import { ListPageTable } from './ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from './ListTableSelectColumns'
import {
  cadastroFieldCls,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import Badge from './Badge'
import { isProprioOwnershipPercent } from '../utils/ownershipPercentUi'

interface Tag {
  id: number
  name: string
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  tag_name: string
  type: string
}

interface Account {
  id: number
  name: string
  description: string | null
  bank?: { name?: string; code?: string } | null
  agency?: string | number | null
  account_number?: string | number | null
}

interface Partner {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  active: boolean
  shared_account: Account | null
}

interface UnmappedRecord {
  id: number
  date: string
  description: string
  amount: number
  source: 'bank' | 'card' | 'benefit'
  card_number?: string
  card_owner?: string
  category?: string
  tag_id?: number | null
  subtag_id?: number | null
  expense_sharing_id?: number | null
  ownership_percentage?: number | null
  current_installment?: number | null
  total_installments?: number | null
  year_month?: string | null
}

interface GroupDetailsModalProps {
  groupDescription: string
  records: UnmappedRecord[]
  tags: Tag[]
  subtags: Subtag[]
  partners: Partner[]
  tipo: 'receita' | 'despesa'
  onClose: () => void
  onChange?: (updatedRecords: UnmappedRecord[]) => void
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const

function formatMonthOnly(yearMonth: string): string {
  const [, month] = yearMonth.split('-')
  const monthIndex = parseInt(month, 10) - 1
  if (monthIndex < 0 || monthIndex > 11) return yearMonth
  return MONTH_SHORT[monthIndex]
}

function recordPeriodKey(record: UnmappedRecord): { year: string; monthKey: string } {
  if (record.source === 'card' && record.year_month) {
    const [year, month] = record.year_month.split('-')
    const monthPadded = month.padStart(2, '0')
    return { year, monthKey: `${year}-${monthPadded}` }
  }
  const date = new Date(record.date)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return { year, monthKey: `${year}-${month}` }
}

function buildPeriodIndex(records: UnmappedRecord[]) {
  const groupedByMonth: Record<string, UnmappedRecord[]> = {}
  const groupedByYear: Record<string, string[]> = {}

  records.forEach((record) => {
    const { year, monthKey } = recordPeriodKey(record)
    if (!groupedByMonth[monthKey]) groupedByMonth[monthKey] = []
    groupedByMonth[monthKey].push(record)
    if (!groupedByYear[year]) groupedByYear[year] = []
    if (!groupedByYear[year].includes(monthKey)) groupedByYear[year].push(monthKey)
  })

  Object.keys(groupedByYear).forEach((year) => {
    groupedByYear[year].sort((a, b) => b.localeCompare(a))
  })

  Object.keys(groupedByMonth).forEach((key) => {
    groupedByMonth[key].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  })

  const sortedYears = Object.keys(groupedByYear).sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
  return { groupedByMonth, groupedByYear, sortedYears }
}

function resolveItemDisplayName(groupDescription: string, records: UnmappedRecord[]): string {
  const fromRecord = records.find((r) => r.description?.trim())?.description?.trim()
  if (fromRecord) return fromRecord
  const quoted = groupDescription.match(/"([^"]+)"/)
  if (quoted?.[1]) return quoted[1]
  return groupDescription
}

const GroupDetailsModal = ({
  groupDescription,
  records,
  tags,
  subtags,
  partners,
  tipo,
  onClose,
  onChange,
}: GroupDetailsModalProps) => {
  const [individualMappings, setIndividualMappings] = useState<Record<number, {
    tag_id: number | null,
    subtag_id: number | null,
    expense_sharing_id: number | null,
    ownership_percentage: number | null
  }>>({})
  const [activeYear, setActiveYear] = useState('')
  const [activeMonth, setActiveMonth] = useState('')

  const periodIndex = useMemo(() => buildPeriodIndex(records), [records])
  const itemDisplayName = useMemo(
    () => resolveItemDisplayName(groupDescription, records),
    [groupDescription, records],
  )

  useEffect(() => {
    const firstYear = periodIndex.sortedYears[0]
    if (!firstYear) {
      setActiveYear('')
      setActiveMonth('')
      return
    }
    setActiveYear(firstYear)
    const firstMonth = periodIndex.groupedByYear[firstYear]?.[0] ?? ''
    setActiveMonth(firstMonth)
  }, [periodIndex, records])

  const monthsOfActiveYear = activeYear ? periodIndex.groupedByYear[activeYear] ?? [] : []
  const activeMonthRecords = activeMonth ? periodIndex.groupedByMonth[activeMonth] ?? [] : []
  const tipoAccentVar = tipo === 'receita' ? 'var(--color-success)' : 'var(--color-danger)'
  const TipoPanelIcon = tipo === 'receita' ? ArrowUp : ArrowDown

  useEscapeKey(onClose, true)

  // Filtra tags por tipo (todas as tags que têm subtags do tipo correto)
  const filteredTags = tags.filter(t => {
    const hasSubtagsOfType = subtags.some(s => s.tag_id === t.id && s.type === tipo)
    return hasSubtagsOfType
  })

  // Filtra subtags por tag_id e tipo
  const getFilteredSubtags = (tagId: number | null) => {
    if (!tagId) return []
    return subtags.filter(s => s.tag_id === tagId && s.type === tipo)
  }

  const handleIndividualTagChange = (recordId: number, tagId: number) => {
    const prevMapping = individualMappings[recordId]
    const record = records.find(r => r.id === recordId)

    setIndividualMappings(prev => ({
      ...prev,
      [recordId]: {
        tag_id: tagId,
        subtag_id: null,
        expense_sharing_id: prevMapping?.expense_sharing_id ?? record?.expense_sharing_id ?? null,
        ownership_percentage: prevMapping?.ownership_percentage ?? record?.ownership_percentage ?? null
      }
    }))

    // Atualizar o record real e notificar o pai
    if (onChange) {
      const updatedRecords = records.map(r =>
        r.id === recordId ? { ...r, tag_id: tagId, subtag_id: null } : r
      )
      onChange(updatedRecords)
    }
  }

  const handleIndividualSubtagChange = (recordId: number, subtagId: number) => {
    const mapping = individualMappings[recordId]
    const record = records.find(r => r.id === recordId)

    if (mapping || record) {
      const tagId = mapping?.tag_id ?? record?.tag_id

      setIndividualMappings(prev => ({
        ...prev,
        [recordId]: {
          tag_id: tagId || null,
          subtag_id: subtagId,
          expense_sharing_id: mapping?.expense_sharing_id ?? record?.expense_sharing_id ?? null,
          ownership_percentage: mapping?.ownership_percentage ?? record?.ownership_percentage ?? null
        }
      }))

      // Atualizar o record real e notificar o pai
      if (onChange) {
        const updatedRecords = records.map(r =>
          r.id === recordId ? { ...r, tag_id: tagId || r.tag_id, subtag_id: subtagId } : r
        )
        onChange(updatedRecords)
      }
    }
  }

  const handleIndividualSharingChange = (recordId: number, sharingId: number | null) => {
    const mapping = individualMappings[recordId]
    const record = records.find(r => r.id === recordId)

    // Obter porcentagem padrão do parceiro se selecionado
    const partner = sharingId ? partners.find(p => p.id === sharingId) : null
    const defaultPercentage = sharingPercentForKind(partner, tipo === 'receita' ? 'revenue' : 'expense')

    setIndividualMappings(prev => ({
      ...prev,
      [recordId]: {
        tag_id: mapping?.tag_id ?? record?.tag_id ?? null,
        subtag_id: mapping?.subtag_id ?? record?.subtag_id ?? null,
        expense_sharing_id: sharingId,
        ownership_percentage: sharingId ? defaultPercentage : null
      }
    }))

    // Atualizar o record real e notificar o pai
    if (onChange) {
      const updatedRecords = records.map(r =>
        r.id === recordId ? {
          ...r,
          expense_sharing_id: sharingId,
          ownership_percentage: sharingId ? defaultPercentage : null
        } : r
      )
      onChange(updatedRecords)
    }
  }

  const handleIndividualPercentageChange = (recordId: number, percentage: string) => {
    const mapping = individualMappings[recordId]
    const record = records.find(r => r.id === recordId)
    const parsedPercentage = parseFloat(percentage)
    const finalPercentage = !isNaN(parsedPercentage) ? parsedPercentage : null

    setIndividualMappings(prev => ({
      ...prev,
      [recordId]: {
        tag_id: mapping?.tag_id ?? record?.tag_id ?? null,
        subtag_id: mapping?.subtag_id ?? record?.subtag_id ?? null,
        expense_sharing_id: mapping?.expense_sharing_id ?? record?.expense_sharing_id ?? null,
        ownership_percentage: finalPercentage
      }
    }))

    // Atualizar o record real e notificar o pai
    if (onChange) {
      const updatedRecords = records.map(r =>
        r.id === recordId ? { ...r, ownership_percentage: finalPercentage } : r
      )
      onChange(updatedRecords)
    }
  }

  return (
    <CadastroModalShell maxWidth="max-w-7xl" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title="Detalhes do grupo"
        subtitle={`${records.length} ${records.length === 1 ? 'registro' : 'registros'} · ${tipo === 'receita' ? 'Receita' : 'Despesa'}`}
        onClose={onClose}
        icon={tipo === 'receita' ? <ArrowUpCircle size={18} /> : <ArrowDownCircle size={18} />}
        iconStyle={
          tipo === 'receita'
            ? { backgroundColor: 'var(--color-success)', color: 'var(--on-color-success)' }
            : { backgroundColor: 'var(--color-danger)', color: 'var(--on-color-danger)' }
        }
      />
      <CadastroModalBody>
        <article className={`${listPageTableSectionCls} mb-4 overflow-hidden`}>
          <div
            className="flex items-start gap-3 border-b border-l-4 border-gray-200 px-5 py-4 dark:border-gray-600"
            style={{ borderLeftColor: tipoAccentVar }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-[color-mix(in_srgb,var(--color-1)_20%,transparent)]"
              style={{
                color: tipoAccentVar,
                background: `color-mix(in srgb, ${tipoAccentVar} 14%, transparent)`,
              }}
            >
              <TipoPanelIcon size={18} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="break-words text-lg font-bold text-gray-900 dark:text-white"
                title={itemDisplayName}
              >
                {itemDisplayName}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {records.length} {records.length === 1 ? 'registro' : 'registros'} ·{' '}
                {tipo === 'receita' ? 'Receita' : 'Despesa'}
              </p>
            </div>
          </div>
        </article>

        {periodIndex.sortedYears.length > 0 ? (
          <div className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <Calendar size={16} style={{ color: 'var(--color-1)' }} aria-hidden />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Período</span>
            </div>
            <div className="flex overflow-x-auto border-b border-gray-200 px-2 dark:border-gray-700">
              {periodIndex.sortedYears.map((year) => {
                const monthKeys = periodIndex.groupedByYear[year] ?? []
                const totalInYear = monthKeys.reduce(
                  (sum, monthKey) => sum + (periodIndex.groupedByMonth[monthKey]?.length ?? 0),
                  0,
                )
                const isActive = activeYear === year
                return (
                  <button
                    key={year}
                    type="button"
                    onClick={() => {
                      setActiveYear(year)
                      const firstMonth = periodIndex.groupedByYear[year]?.[0]
                      if (firstMonth) setActiveMonth(firstMonth)
                    }}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
                      isActive
                        ? 'border-[var(--color-1)] text-[var(--color-1)]'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    {year}
                    <Badge
                      variant="tab"
                      tone="brand1"
                      className="bg-[var(--color-1)] text-[var(--on-color-1)]"
                      label={String(totalInYear)}
                    />
                  </button>
                )
              })}
            </div>
            {monthsOfActiveYear.length > 0 ? (
              <div className="flex overflow-x-auto bg-gray-50/80 px-2 dark:bg-gray-800/50">
                {monthsOfActiveYear.map((monthKey) => {
                  const isActive = activeMonth === monthKey
                  const monthCount = periodIndex.groupedByMonth[monthKey]?.length ?? 0
                  return (
                    <button
                      key={monthKey}
                      type="button"
                      onClick={() => setActiveMonth(monthKey)}
                      className={`flex min-w-[4.5rem] flex-1 items-center justify-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-all ${
                        isActive
                          ? 'border-[var(--color-2)] text-[var(--color-2)]'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
                      }`}
                    >
                      {formatMonthOnly(monthKey)}
                      <Badge
                        variant="tab"
                        tone="brand2"
                        className={
                          isActive
                            ? 'bg-[var(--color-2)] text-[var(--on-color-2)]'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }
                        label={String(monthCount)}
                      />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeMonthRecords.length > 0 ? (
          <ListPageTable
            minWidth={1100}
            leadingMode="index-only"
            colsRest={
              <>
                <ListTableSpacerCol />
                <col style={{ width: 56, minWidth: 56 }} />
                <col style={{ width: 128, minWidth: 120 }} />
                <col style={{ width: 96, minWidth: 88 }} />
                <col style={{ width: '16%', minWidth: 140 }} />
                <col style={{ width: '16%', minWidth: 140 }} />
                <col style={{ width: '18%', minWidth: 160 }} />
                <col style={{ width: 88, minWidth: 80 }} />
              </>
            }
            head={
              <tr>
                <ListTableIndexHeader />
                <ListTableSpacerHeader />
                <ListTableStaticHeader label="Fonte" className="text-center" />
                <ListTableStaticHeader label="Data" />
                <ListTableStaticHeader label="Valor" />
                <ListTableStaticHeader label="Tag" />
                <ListTableStaticHeader label="Subtag" />
                <ListTableStaticHeader label="Compartilhamento" />
                <ListTableStaticHeader label="Sua conta %" />
              </tr>
            }
          >
            {activeMonthRecords.map((record, index) => {
              const mapping = individualMappings[record.id]
              const selectedTag = mapping?.tag_id ?? record.tag_id
              const selectedSubtag = mapping?.subtag_id ?? record.subtag_id
              const selectedSharing = mapping?.expense_sharing_id ?? record.expense_sharing_id
              const selectedPercentage = mapping?.ownership_percentage ?? record.ownership_percentage

              return (
                <tr key={record.id} className={listPageTableRowHoverCls}>
                  <ListTableIndexCell index={index + 1} />
                  <ListTableSpacerCell />
                  <td className={`${listPageTableTdCls} text-center`}>
                    {record.source === 'bank' ? (
                      <Landmark size={16} className="inline" style={{ color: 'var(--color-1)' }} aria-label="Extrato" />
                    ) : record.source === 'card' ? (
                      <CreditCard size={16} className="inline" style={{ color: 'var(--color-2)' }} aria-label="Cartão" />
                    ) : (
                      <Gift size={16} className="inline" style={{ color: 'var(--color-3)' }} aria-label="Benefício" />
                    )}
                  </td>
                  <td className={`${listPageTableTdCls} whitespace-nowrap text-xs text-gray-600 dark:text-gray-400`}>
                    {new Date(record.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    {' '}
                    {new Date(record.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    {record.source === 'card' && record.current_installment && record.total_installments ? (
                      <span className="ml-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {record.current_installment}/{record.total_installments}
                      </span>
                    ) : null}
                  </td>
                  <td className={listPageTableTdCls}>
                    <span
                      className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
                        record.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {formatCurrencyWithColor(record.amount, false)}
                    </span>
                  </td>
                  <td className={listPageTableTdCls}>
                    <select
                      value={selectedTag || ''}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value) handleIndividualTagChange(record.id, Number(value))
                      }}
                      className={`${cadastroFieldCls} min-w-0 py-1.5 text-xs`}
                    >
                      <option value="">Selecione...</option>
                      {filteredTags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={listPageTableTdCls}>
                    <select
                      value={selectedSubtag || ''}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value) handleIndividualSubtagChange(record.id, Number(value))
                      }}
                      disabled={!selectedTag}
                      className={`${cadastroFieldCls} min-w-0 py-1.5 text-xs disabled:bg-gray-100 dark:disabled:bg-gray-800`}
                    >
                      <option value="">Selecione...</option>
                      {getFilteredSubtags(selectedTag || null).map((subtag) => (
                        <option key={subtag.id} value={subtag.id}>
                          {subtag.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={listPageTableTdCls}>
                    <select
                      value={selectedSharing || ''}
                      onChange={(e) => {
                        const value = e.target.value
                        handleIndividualSharingChange(record.id, value ? Number(value) : null)
                      }}
                      className={`${cadastroFieldCls} min-w-0 py-1.5 text-xs`}
                    >
                      <option value="">Selecione...</option>
                      {partners
                        .filter((p) => p.active)
                        .map((partner) => (
                          <option key={partner.id} value={partner.id}>
                            {sharingPartnerLabel(partner)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className={listPageTableTdCls}>
                    <div className="flex flex-col items-center gap-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={selectedPercentage ?? ''}
                        onChange={(e) => handleIndividualPercentageChange(record.id, e.target.value)}
                        disabled={!selectedSharing}
                        placeholder="50"
                        title="Quanto do valor entra no fechamento da sua conta"
                        className={`${cadastroFieldCls} w-full py-1.5 text-center text-xs disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-800`}
                      />
                      {selectedSharing && isProprioOwnershipPercent(selectedPercentage) ? (
                        <Badge variant="statusCompact" tone="brand1" label="Próprio" />
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </ListPageTable>
        ) : (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Nenhum registro neste período.
          </p>
        )}
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} hideSave closeLabel="Fechar" />
    </CadastroModalShell>
  )
}

export default GroupDetailsModal

