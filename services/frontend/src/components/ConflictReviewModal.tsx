import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { ImportConflict, ConflictResolution } from '../types/importConflict'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  cadastroFieldCls,
} from './CadastroFormLayout'
import { listPageTableRowHoverCls, listPageTableTdCls } from './CadastroListPageLayout'
import { ListPageTable } from './ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from './ListTableSelectColumns'
import { formatCurrency } from '../utils/currency'
import { formatDateBR } from '../utils/dateUtils'

const moneyStyle = (value: number) => ({
  color: value >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
})

const getConflictKey = (conflict: ImportConflict, index: number): string => {
  if (conflict.existing_id !== null) {
    return `id:${conflict.existing_id}:${index}`
  }
  return `multi:${conflict.date}:${conflict.description}:${index}`
}

interface ConflictReviewModalProps {
  isOpen: boolean
  onClose: () => void
  conflicts: ImportConflict[]
  onResolve: (resolutions: ConflictResolution[]) => Promise<void>
}

function formatTagPair(tag: string | null | undefined, subtag: string | null | undefined) {
  if (!tag && !subtag) return '—'
  return `${tag || '—'} / ${subtag || '—'}`
}

function tagBefore(conflict: ImportConflict) {
  if (conflict.tag_conflict) {
    return formatTagPair(conflict.tag_conflict.original_tag_name, conflict.tag_conflict.original_subtag_name)
  }
  return formatTagPair(conflict.existing_tag_name, conflict.existing_subtag_name)
}

function tagAfter(conflict: ImportConflict) {
  if (conflict.tag_conflict) {
    return formatTagPair(conflict.tag_conflict.new_tag_name, conflict.tag_conflict.new_subtag_name)
  }
  return formatTagPair(conflict.new_tag_name, conflict.new_subtag_name)
}

function amountBefore(conflict: ImportConflict, selectedMatchId?: number) {
  if (conflict.amount_conflict) return conflict.amount_conflict.original_amount
  if (conflict.multiple_matches?.length && selectedMatchId) {
    return conflict.multiple_matches.find((m) => m.id === selectedMatchId)?.amount ?? null
  }
  if (conflict.existing_amount != null) return conflict.existing_amount
  return null
}

function amountAfter(conflict: ImportConflict) {
  if (conflict.amount_conflict) return conflict.amount_conflict.new_amount
  if (conflict.new_amount != null) return conflict.new_amount
  return null
}

function changeLabels(conflict: ImportConflict) {
  const parts: string[] = []
  if (conflict.tag_conflict) parts.push('Tag')
  if (conflict.amount_conflict) parts.push('Valor')
  if (conflict.multiple_matches?.length) parts.push('Registro')
  return parts.length ? parts.join(' + ') : '—'
}

function moneyCell(value: number | null | undefined) {
  if (value == null) return <span className="text-gray-400">—</span>
  return (
    <span className="font-semibold tabular-nums" style={moneyStyle(value)}>
      {formatCurrency(value)}
    </span>
  )
}

const ConflictReviewModal = ({ isOpen, onClose, conflicts, onResolve }: ConflictReviewModalProps) => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectedMatches, setSelectedMatches] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const indexedConflicts = useMemo(
    () => conflicts.map((conflict, index) => ({ conflict, index, key: getConflictKey(conflict, index) })),
    [conflicts],
  )

  const showFileColumn = useMemo(() => {
    const files = new Set(conflicts.map((c) => c.source_file || 'Arquivo não identificado'))
    return files.size > 1
  }, [conflicts])

  useEffect(() => {
    if (conflicts.length > 0) {
      setSelectedKeys(new Set())
      setSelectedMatches({})
    }
  }, [conflicts])

  const allKeys = useMemo(() => indexedConflicts.map((item) => item.key), [indexedConflicts])

  const selectAllState = useMemo(() => {
    if (allKeys.length === 0) return 'none' as const
    const selectedCount = allKeys.filter((key) => selectedKeys.has(key)).length
    if (selectedCount === 0) return 'none' as const
    if (selectedCount === allKeys.length) return 'all' as const
    return 'partial' as const
  }, [allKeys, selectedKeys])

  const toggleSelectAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (prev.size === allKeys.length) return new Set()
      return new Set(allKeys)
    })
  }, [allKeys])

  const toggleRow = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleCloseRequest = () => setShowCancelConfirm(true)

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false)
    onClose()
  }

  useEscapeKey(handleCloseRequest, isOpen && !showCancelConfirm)

  const handleSubmit = async () => {
    const selectedRows = indexedConflicts.filter(({ key }) => selectedKeys.has(key))
    const missingMatch = selectedRows.filter(({ conflict, key }) => {
      if (!conflict.multiple_matches?.length) return false
      return !selectedMatches[key]
    })
    if (missingMatch.length > 0) {
      alert(`Selecione qual registro atualizar em ${missingMatch.length} linha(s) marcada(s).`)
      return
    }

    setIsSubmitting(true)
    try {
      const resolvedConflicts: ConflictResolution[] = indexedConflicts.map(({ conflict, key }) => {
        const selected = selectedKeys.has(key)
        const isMultipleMatch = !!conflict.multiple_matches?.length
        const selectedMatchId = selectedMatches[key]
        const acceptTag =
          selected &&
          (!!conflict.tag_conflict || (isMultipleMatch && conflict.new_subtag_id != null))
        const acceptAmount = selected && (!!conflict.amount_conflict || isMultipleMatch)

        return {
          existing_id: isMultipleMatch ? (selectedMatchId || 0) : (conflict.existing_id || 0),
          record_type: conflict.record_type,
          accept_tag_change: acceptTag,
          accept_amount_change: acceptAmount,
          new_subtag_id: conflict.new_subtag_id ?? conflict.tag_conflict?.new_subtag_id,
          new_amount: conflict.new_amount ?? conflict.amount_conflict?.new_amount,
          selected_from_multiple: isMultipleMatch && !!selectedMatchId && selected,
        }
      })
      await onResolve(resolvedConflicts)
    } catch (error) {
      console.error('Erro ao resolver conflitos:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedCount = selectedKeys.size

  const renderTable = (rows: Array<{ conflict: ImportConflict; index: number }>, showFileColumn: boolean) => (
    <ListPageTable
      framed={false}
      leadingMode="bulk-index-first"
      minWidth={showFileColumn ? 1280 : 1120}
      colsRest={
        <>
          <ListTableSpacerCol />
          <col style={{ width: 56, minWidth: 56, maxWidth: 64 }} />
          <col style={{ width: 104, minWidth: 104, maxWidth: 120 }} />
          <col style={{ width: '28%', minWidth: 220 }} />
          {showFileColumn ? <col style={{ width: 140, minWidth: 120 }} /> : null}
          <col style={{ width: 108, minWidth: 96 }} />
          <col style={{ width: 132, minWidth: 120 }} />
          <col style={{ width: 132, minWidth: 120 }} />
          <col style={{ width: 108, minWidth: 96 }} />
          <col style={{ width: 108, minWidth: 96 }} />
          <col style={{ width: 168, minWidth: 148 }} />
        </>
      }
      head={
        <tr>
          <ListTableIndexHeader />
          <ListTableCheckboxHeader state={selectAllState} onToggle={toggleSelectAll} />
          <ListTableSpacerHeader />
          <ListTableStaticHeader label="ID" />
          <ListTableStaticHeader label="Data" />
          <ListTableStaticHeader label="Descrição" />
          {showFileColumn ? <ListTableStaticHeader label="Arquivo" /> : null}
          <ListTableStaticHeader label="Alteração" />
          <ListTableStaticHeader label="Tag (atual)" />
          <ListTableStaticHeader label="Tag (arquivo)" />
          <ListTableStaticHeader label="Valor (atual)" className="text-right" />
          <ListTableStaticHeader label="Valor (arquivo)" className="text-right" />
          <ListTableStaticHeader label="Registro" />
        </tr>
      }
    >
      {rows.map(({ conflict, index }) => {
        const key = getConflictKey(conflict, index)
        const checked = selectedKeys.has(key)
        const matchId = selectedMatches[key]
        const hasMultiple = !!conflict.multiple_matches?.length
        const tagChanged = !!conflict.tag_conflict
        const amountChanged = !!conflict.amount_conflict || hasMultiple
        const lineLabel = conflict.source_line ?? '—'

        return (
          <tr key={key} className={listPageTableRowHoverCls}>
            <ListTableIndexCell index={lineLabel} />
            <ListTableCheckboxCell checked={checked} onToggle={() => toggleRow(key)} />
            <ListTableSpacerCell />
            <td className={`${listPageTableTdCls} tabular-nums text-xs text-gray-600 dark:text-gray-400`}>
              {conflict.existing_id != null ? conflict.existing_id : '—'}
            </td>
            <td className={`${listPageTableTdCls} whitespace-nowrap text-xs`}>
              {formatDateBR(conflict.date)}
              {conflict.year_month ? (
                <span className="block text-[10px] text-gray-400">{conflict.year_month}</span>
              ) : null}
            </td>
            <td
              className={`${listPageTableTdCls} text-sm font-medium text-gray-900 dark:text-white break-words`}
              title={conflict.description}
            >
              {conflict.description || '—'}
            </td>
            {showFileColumn ? (
              <td className={`${listPageTableTdCls} truncate text-xs text-gray-600 dark:text-gray-400`} title={conflict.source_file}>
                {conflict.source_file || '—'}
              </td>
            ) : null}
            <td className={`${listPageTableTdCls} text-xs font-medium text-amber-700 dark:text-amber-400`}>
              {changeLabels(conflict)}
            </td>
            <td className={`${listPageTableTdCls} text-xs text-gray-600 dark:text-gray-400 ${tagChanged ? 'line-through' : ''}`}>
              {tagChanged || conflict.existing_tag_name ? tagBefore(conflict) : '—'}
            </td>
            <td className={`${listPageTableTdCls} text-xs font-medium text-gray-900 dark:text-white`}>
              {tagChanged || conflict.new_tag_name ? tagAfter(conflict) : '—'}
            </td>
            <td className={`${listPageTableTdCls} text-right ${amountChanged ? 'line-through opacity-80' : ''}`}>
              {moneyCell(amountBefore(conflict, matchId))}
            </td>
            <td className={`${listPageTableTdCls} text-right`}>{moneyCell(amountAfter(conflict))}</td>
            <td className={listPageTableTdCls}>
              {hasMultiple ? (
                <select
                  className={`${cadastroFieldCls} min-w-0 py-1 text-xs`}
                  value={matchId ?? ''}
                  disabled={!checked}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setSelectedMatches((prev) => ({
                      ...prev,
                      [key]: value,
                    }))
                  }}
                >
                  <option value="">Escolher…</option>
                  {conflict.multiple_matches!.map((match) => (
                    <option key={match.id} value={match.id}>
                      #{match.id} · {formatCurrency(match.amount)}
                      {match.subtag_name ? ` · ${match.tag_name}/${match.subtag_name}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-400 text-xs">—</span>
              )}
            </td>
          </tr>
        )
      })}
    </ListPageTable>
  )

  if (!isOpen) return null

  const tableRows = indexedConflicts.map(({ conflict, index }) => ({ conflict, index }))

  return (
    <>
      <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90rem]" zClass="z-[110]" onBackdropClick={handleCloseRequest}>
        <CadastroModalHeader
          isEdit={false}
          title="Conflitos na importação"
          subtitle={`${conflicts.length} diferença(s) entre o arquivo e o que já está salvo. Marque as linhas que deseja aplicar.`}
          onClose={handleCloseRequest}
          icon={<AlertTriangle size={18} />}
          iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
        />

        <CadastroModalBody>
          <CadastroFormSection
            title="Alterações detectadas"
            hint="Nenhuma linha vem marcada por padrão. Coluna Registro: escolha o lançamento quando houver mais de um candidato."
            icon={<FileText size={14} />}
            bodyClassName="p-0"
          >
            {renderTable(tableRows, showFileColumn)}
          </CadastroFormSection>
        </CadastroModalBody>

        <CadastroModalFooter
          onClose={handleCloseRequest}
          onSave={handleSubmit}
          saving={isSubmitting}
          saveLabel={
            selectedCount === 0
              ? 'Continuar sem aplicar'
              : `Aplicar ${selectedCount} selecionado${selectedCount === 1 ? '' : 's'}`
          }
        />
      </CadastroModalShell>

      {showCancelConfirm && (
        <CadastroModalShell maxWidth="max-w-md" zClass="z-[120]" onBackdropClick={() => setShowCancelConfirm(false)}>
          <CadastroModalHeader
            isEdit={false}
            title="Descartar revisão?"
            subtitle="Nenhuma alteração marcada será aplicada; os valores atuais no banco permanecem."
            onClose={() => setShowCancelConfirm(false)}
            icon={<AlertTriangle size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-danger)', color: 'var(--on-color-danger)' }}
          />
          <CadastroModalBody>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Use &quot;Continuar sem aplicar&quot; para fechar mantendo o banco como está, ou volte para marcar linhas específicas.
            </p>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setShowCancelConfirm(false)}
            closeLabel="Voltar"
            onSave={handleConfirmCancel}
            saveLabel="Fechar sem aplicar"
            saveTone="danger"
          />
        </CadastroModalShell>
      )}
    </>
  )
}

export default ConflictReviewModal
