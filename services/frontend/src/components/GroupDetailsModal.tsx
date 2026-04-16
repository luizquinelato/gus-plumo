import { useState, useEffect } from 'react'
import { X, ArrowUpCircle, ArrowDownCircle, Landmark, CreditCard, Gift, Tag as TagIcon, Tags as TagsIcon, Users } from 'lucide-react'
import { formatCurrencyWithColor } from '../utils/currency'

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
  onApply?: () => void
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
  onApply
}: GroupDetailsModalProps) => {
  const [individualMappings, setIndividualMappings] = useState<Record<number, {
    tag_id: number | null,
    subtag_id: number | null,
    expense_sharing_id: number | null,
    ownership_percentage: number | null
  }>>({})
  const [globalTag, setGlobalTag] = useState<number | null>(null)
  const [globalSubtag, setGlobalSubtag] = useState<number | null>(null)
  const [globalSharing, setGlobalSharing] = useState<number | null>(null)
  const [globalPercentage, setGlobalPercentage] = useState<string>('')

  // Função para aplicar tag/subtag/compartilhamento a todos os registros
  // Aplica apenas os campos que foram preenchidos
  const handleApplyToAll = () => {
    const hasTagSubtag = globalTag && globalSubtag
    const hasSharing = globalSharing !== null

    // Precisa ter pelo menos tag/subtag OU compartilhamento
    if (!hasTagSubtag && !hasSharing) return

    // Calcular porcentagem: usar valor digitado ou padrão do parceiro
    const parsedPercentage = parseFloat(globalPercentage)
    const sharingPercentage = globalSharing
      ? (!isNaN(parsedPercentage) ? parsedPercentage : (partners.find(p => p.id === globalSharing)?.my_contribution_percentage || 50))
      : null

    const newMappings: Record<number, {
      tag_id: number | null,
      subtag_id: number | null,
      expense_sharing_id: number | null,
      ownership_percentage: number | null
    }> = {}

    records.forEach(record => {
      const existingMapping = individualMappings[record.id]
      newMappings[record.id] = {
        // Se tem tag/subtag global, usa; senão mantém o existente ou do record
        tag_id: hasTagSubtag ? globalTag : (existingMapping?.tag_id ?? record.tag_id ?? null),
        subtag_id: hasTagSubtag ? globalSubtag : (existingMapping?.subtag_id ?? record.subtag_id ?? null),
        // Sempre aplica compartilhamento (mesmo que seja null para "limpar")
        expense_sharing_id: hasSharing ? globalSharing : (existingMapping?.expense_sharing_id ?? record.expense_sharing_id ?? null),
        ownership_percentage: hasSharing ? sharingPercentage : (existingMapping?.ownership_percentage ?? record.ownership_percentage ?? null)
      }
    })
    setIndividualMappings(newMappings)

    // Atualizar todos os records reais e notificar o pai
    if (onChange) {
      const updatedRecords = records.map(r => {
        const mapping = newMappings[r.id]
        return {
          ...r,
          tag_id: mapping?.tag_id ?? r.tag_id,
          subtag_id: mapping?.subtag_id ?? r.subtag_id,
          expense_sharing_id: mapping?.expense_sharing_id ?? r.expense_sharing_id,
          ownership_percentage: mapping?.ownership_percentage ?? r.ownership_percentage
        }
      })
      onChange(updatedRecords)
    }

    // Notificar que aplicou (para mostrar Toast)
    if (onApply) {
      onApply()
    }
  }

  // Fechar modal com ESC e aplicar com Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT' && target.tagName !== 'INPUT') {
          e.preventDefault()
          handleApplyToAll()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, globalTag, globalSubtag, globalSharing, globalPercentage, records, onChange, partners])

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

  // Agrupa registros por ano e mês (ordenado do mais novo para o mais antigo)
  // Retorna um array para garantir a ordem de iteração
  const groupRecordsByYearAndMonth = (): Array<{ year: string, months: Array<{ month: string, records: UnmappedRecord[] }> }> => {
    const grouped: Record<string, Record<string, { records: UnmappedRecord[], monthNumber: number }>> = {}

    records.forEach(record => {
      let year: string
      let monthNumber: number
      let month: string

      if (record.source === 'card' && record.year_month) {
        const [yearStr, monthStr] = record.year_month.split('-')
        year = yearStr
        monthNumber = parseInt(monthStr)
        const monthIndex = monthNumber - 1
        const monthDate = new Date(2000, monthIndex, 1)
        month = monthDate.toLocaleDateString('pt-BR', { month: 'long' })
      } else {
        const date = new Date(record.date)
        year = date.getFullYear().toString()
        monthNumber = date.getMonth() + 1
        month = date.toLocaleDateString('pt-BR', { month: 'long' })
      }

      if (!grouped[year]) {
        grouped[year] = {}
      }
      if (!grouped[year][month]) {
        grouped[year][month] = { records: [], monthNumber }
      }
      grouped[year][month].records.push(record)
    })

    // Ordena anos (mais novo primeiro) - 2026 antes de 2025
    const sortedYears = Object.keys(grouped).sort((a, b) => parseInt(b) - parseInt(a))

    // Retorna array ordenado para garantir ordem de iteração
    return sortedYears.map(year => {
      const monthsData = grouped[year]
      // Ordena meses dentro de cada ano (mais novo primeiro) - dezembro antes de janeiro
      const sortedMonths = Object.entries(monthsData)
        .sort((a, b) => b[1].monthNumber - a[1].monthNumber)
        .map(([month, data]) => {
          // Ordena registros dentro de cada mês por data (mais novo primeiro)
          const sortedRecords = [...data.records].sort((a, b) => {
            const dateA = new Date(a.date).getTime()
            const dateB = new Date(b.date).getTime()
            return dateB - dateA // Mais novo primeiro
          })
          return { month, records: sortedRecords }
        })

      return { year, months: sortedMonths }
    })
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
    const defaultPercentage = partner?.my_contribution_percentage || 50

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

  const groupedRecords = groupRecordsByYearAndMonth()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {tipo === 'receita' ? (
              <ArrowUpCircle size={24} className="text-green-600 dark:text-green-400 flex-shrink-0" />
            ) : (
              <ArrowDownCircle size={24} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            )}
            <h2 className={`text-xl font-semibold ${tipo === 'receita' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
              {groupDescription} <span className="text-sm font-normal text-gray-600 dark:text-gray-400">({records.length} {records.length === 1 ? 'registro' : 'registros'})</span>
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X size={20} className="text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Aplicar a Todos - Fixo no Topo */}
        <div className="p-4 border-b-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              Aplicar a Todos:
            </span>
          </div>
          <div className="flex gap-3">
            {/* Tag */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                <TagIcon size={14} className="inline mr-1 text-color-primary" />
                Tag
              </label>
              <select
                value={globalTag || ''}
                onChange={(e) => {
                  const value = e.target.value
                  if (value) {
                    setGlobalTag(Number(value))
                    setGlobalSubtag(null)
                  } else {
                    setGlobalTag(null)
                    setGlobalSubtag(null)
                  }
                }}
                className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione...</option>
                {filteredTags.map(tag => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </div>

            {/* Subtag */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                <TagsIcon size={14} className="inline mr-1 text-color-primary" />
                Subtag
              </label>
              <select
                value={globalSubtag || ''}
                onChange={(e) => {
                  const value = e.target.value
                  if (value) {
                    setGlobalSubtag(Number(value))
                  } else {
                    setGlobalSubtag(null)
                  }
                }}
                disabled={!globalTag}
                className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800"
              >
                <option value="">Selecione...</option>
                {getFilteredSubtags(globalTag).map(subtag => (
                  <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                ))}
              </select>
            </div>

            {/* Compartilhamento */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                <Users size={14} className="inline mr-1 text-color-primary" />
                Compartilhamento
              </label>
              <select
                value={globalSharing || ''}
                onChange={(e) => {
                  const value = e.target.value
                  if (value) {
                    const partner = partners.find(p => p.id === Number(value))
                    setGlobalSharing(Number(value))
                    setGlobalPercentage(partner?.my_contribution_percentage?.toString() || '50')
                  } else {
                    setGlobalSharing(null)
                    setGlobalPercentage('')
                  }
                }}
                className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione...</option>
                {partners.filter(p => p.active).map(partner => {
                  const account = partner.shared_account
                  const displayParts = [
                    account?.name,
                    account?.bank?.name,
                    account?.agency,
                    account?.account_number
                  ].filter(Boolean)
                  const displayText = displayParts.length > 0
                    ? displayParts.join(' - ')
                    : partner.description || `Conta ${partner.shared_account_id}`
                  return (
                    <option key={partner.id} value={partner.id}>
                      {displayText}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Porcentagem */}
            <div className="w-16">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                %
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={globalPercentage}
                onChange={(e) => setGlobalPercentage(e.target.value)}
                disabled={!globalSharing}
                placeholder="50"
                className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-center bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800"
              />
            </div>

            {/* Botão Aplicar */}
            <div className="flex items-end">
              <button
                onClick={handleApplyToAll}
                disabled={!(globalTag && globalSubtag) && !globalSharing}
                className="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm font-medium whitespace-nowrap"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>

        {/* Content - Tabelas por Ano */}
        <div className="flex-1 overflow-y-auto p-4">
          {groupedRecords.map((yearData, yearIndex) => {
            return (
            <div key={yearData.year}>
              {/* Separador entre anos (exceto no primeiro) */}
              {yearIndex > 0 && (
                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t-2 border-gray-300 dark:border-gray-600"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white dark:bg-gray-800 px-4 text-sm text-gray-500 dark:text-gray-400 font-medium">
                      • • •
                    </span>
                  </div>
                </div>
              )}

              <div className="mb-6">
                {/* Cabeçalho do Ano com gradiente 3-4 */}
                <div
                  className="rounded-lg px-6 py-3 shadow-md mb-4"
                  style={{ background: 'linear-gradient(135deg, var(--color-3), var(--color-4))' }}
                >
                  <h3 className="text-lg font-bold text-white flex items-center gap-3">
                    📅 {yearData.year}
                  </h3>
                </div>

                {/* Tabelas por Mês */}
                <div className="space-y-4">
                  {yearData.months.map((monthData) => (
                    <div
                      key={`month-${yearData.year}-${monthData.month}`}
                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden"
                    >
                      {/* Header do Mês com color-5 */}
                      <div
                        className="px-4 py-2 border-b border-gray-200 dark:border-gray-700"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-5) 15%, transparent)' }}
                      >
                        <span className="text-sm font-semibold capitalize flex items-center gap-2" style={{ color: 'var(--color-5)' }}>
                          📆 {monthData.month}
                          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                            ({monthData.records.length} {monthData.records.length === 1 ? 'registro' : 'registros'})
                          </span>
                        </span>
                      </div>

                      {/* Tabela do Mês */}
                      <table className="w-full table-fixed">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>
                            <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-10">Fonte</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 w-20">Data</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 w-20">Valor</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 w-[20%]">Tag</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 w-[20%]">Subtag</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 w-[20%]">Compartilhamento</th>
                            <th className="px-1 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-14">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthData.records.map(record => {
                            const mapping = individualMappings[record.id]
                            const selectedTag = mapping?.tag_id ?? record.tag_id
                            const selectedSubtag = mapping?.subtag_id ?? record.subtag_id
                            const selectedSharing = mapping?.expense_sharing_id ?? record.expense_sharing_id
                            const selectedPercentage = mapping?.ownership_percentage ?? record.ownership_percentage

                            return (
                              <tr
                                key={record.id}
                                className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderLeftColor = ''
                                }}
                              >
                                {/* Fonte - Centralizado */}
                                <td className="px-3 py-2 text-center">
                                  {record.source === 'bank' ? (
                                    <Landmark size={16} className="inline" style={{ color: 'var(--color-1)' }} aria-label="Extrato Bancário" />
                                  ) : record.source === 'card' ? (
                                    <CreditCard size={16} className="inline" style={{ color: 'var(--color-2)' }} aria-label="Fatura de Cartão" />
                                  ) : (
                                    <Gift size={16} className="inline" style={{ color: 'var(--color-3)' }} aria-label="Benefício" />
                                  )}
                                </td>
                                {/* Data */}
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                  {new Date(record.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                  {' '}
                                  {new Date(record.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  {record.source === 'card' && record.current_installment && record.total_installments && (
                                    <span className="ml-2 text-xs text-blue-600 dark:text-blue-400 font-semibold">
                                      {record.current_installment}/{record.total_installments}
                                    </span>
                                  )}
                                </td>
                                {/* Valor */}
                                <td className="px-3 py-2 text-left">
                                  <span className={`text-sm font-semibold whitespace-nowrap ${record.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {formatCurrencyWithColor(record.amount, false)}
                                  </span>
                                </td>
                                {/* Tag */}
                                <td className="px-3 py-2">
                                  <select
                                    value={selectedTag || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (value) {
                                        handleIndividualTagChange(record.id, Number(value))
                                      }
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="">Selecione...</option>
                                    {filteredTags.map(tag => (
                                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                                    ))}
                                  </select>
                                </td>
                                {/* Subtag */}
                                <td className="px-3 py-2">
                                  <select
                                    value={selectedSubtag || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (value) {
                                        handleIndividualSubtagChange(record.id, Number(value))
                                      }
                                    }}
                                    disabled={!selectedTag}
                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800"
                                  >
                                    <option value="">Selecione...</option>
                                    {getFilteredSubtags(selectedTag || null).map(subtag => (
                                      <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                                    ))}
                                  </select>
                                </td>
                                {/* Compartilhamento */}
                                <td className="px-2 py-2">
                                  <select
                                    value={selectedSharing || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      handleIndividualSharingChange(record.id, value ? Number(value) : null)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="">Selecione...</option>
                                    {partners.filter(p => p.active).map(partner => {
                                      const account = partner.shared_account
                                      const displayParts = [
                                        account?.name,
                                        account?.bank?.name,
                                        account?.agency,
                                        account?.account_number
                                      ].filter(Boolean)
                                      const displayText = displayParts.length > 0
                                        ? displayParts.join(' - ')
                                        : partner.description || `Conta ${partner.shared_account_id}`
                                      return (
                                        <option key={partner.id} value={partner.id}>
                                          {displayText}
                                        </option>
                                      )
                                    })}
                                  </select>
                                </td>
                                {/* % */}
                                <td className="px-1 py-2 text-center">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={selectedPercentage ?? ''}
                                    onChange={(e) => handleIndividualPercentageChange(record.id, e.target.value)}
                                    disabled={!selectedSharing}
                                    placeholder="50"
                                    className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-center bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )})}
        </div>

        {/* Footer - Botão Fechar */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={onClose}
            className="px-6 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
            style={{ backgroundColor: 'var(--crud-cancel)' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export default GroupDetailsModal

