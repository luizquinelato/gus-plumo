import type { Dispatch, SetStateAction } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  CreditCard,
  FileText,
  Gift,
  Landmark,
  Loader2,
  Save,
  Tags as TagsIcon,
  Tag as TagIcon,
  Users,
} from 'lucide-react'
import { formatCurrencyWithColor } from '../../utils/currency'
import { sharingPartnerLabel, sharingPercentForKind } from '../../utils/accountFormatter'
import { CadastroFilterField, cadastroRowIconBtnCls } from '../CadastroListPageLayout'
import { WriteGate } from '../../contexts/PageMutationContext'
import { cadastroAccentControlCls, cadastroFieldCls, cadastroOptionLabelCls } from '../CadastroFormLayout'
import { LIST_TABLE_INDEX_COL_PX } from '../ListTableSelectColumns'
import type {
  CuradoriaGroupedRecord,
  CuradoriaPartner,
  CuradoriaSubtag,
  CuradoriaTag,
} from './curadoriaTypes'

const cardListItemCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800'

function curadoriaGroupCardShellCls(tipo: 'receita' | 'despesa', isSaved: boolean): string {
  const base = `${cardListItemCls} border-l-4 hover:border-gray-200 dark:hover:border-gray-700`
  if (!isSaved) return base
  return tipo === 'receita'
    ? `${base} bg-green-50/50 dark:bg-green-900/10`
    : `${base} bg-red-50/50 dark:bg-red-900/10`
}

function curadoriaTabAccentVar(tipo: 'receita' | 'despesa'): string {
  return tipo === 'receita' ? 'var(--color-success)' : 'var(--color-danger)'
}

const curadoriaFieldDividerCls =
  'mx-2 hidden min-h-9 w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-600 sm:block'
const curadoriaMajorDividerCls =
  'mx-2 hidden w-0.5 shrink-0 self-stretch rounded-full bg-gray-300 dark:bg-gray-500 sm:mx-3 sm:block'
const curadoriaFieldsRowCls =
  'flex min-w-0 flex-1 flex-wrap items-center divide-gray-200 dark:divide-gray-600 sm:min-w-0 sm:flex-nowrap sm:divide-x'
const curadoriaFieldCellCls = 'min-w-0 px-0 py-0.5 sm:px-2 sm:first:pl-0'
const curadoriaOptionsColCls = 'flex shrink-0 flex-col justify-center gap-2 py-0.5'

/** Coluna fixa (sm+): título + consolidados empilhados; não empurra Tag/Subtag. */
const curadoriaItemColCls =
  'flex min-w-0 items-start gap-2 max-sm:w-full sm:w-[22rem] sm:min-w-[22rem] sm:max-w-[22rem] sm:shrink-0 sm:basis-[22rem]'
const curadoriaStatsRowCls =
  'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums text-gray-600 dark:text-gray-400 sm:gap-x-2.5'

const indexLeadingStyle = {
  width: LIST_TABLE_INDEX_COL_PX,
  minWidth: LIST_TABLE_INDEX_COL_PX,
}

export type CuradoriaGroupCardProps = {
  group: CuradoriaGroupedRecord
  lineNumber: number
  isSaved: boolean
  isCurrentlySaving: boolean
  createMappingChecked: boolean
  needsApply: boolean
  hasWarning: boolean
  dropdownsDisabled: boolean
  detectedMode: 'pattern' | 'regex'
  partners: CuradoriaPartner[]
  virtualGroupTag: number | null
  virtualGroupSubtag: number | null
  virtualReceitaTag: number | null
  virtualReceitaSubtag: number | null
  virtualGroupSharing: number | null
  virtualGroupPercentage: string
  virtualReceitaSharing: number | null
  virtualReceitaPercentage: string
  overwriteSharing: Record<string, boolean>
  getFilteredTags: (tipo: 'receita' | 'despesa') => CuradoriaTag[]
  getFilteredSubtags: (tagId: number | null, tipo: 'receita' | 'despesa') => CuradoriaSubtag[]
  onGroupTagChange: (groupKey: string, tagId: number | null) => void
  onGroupSubtagChange: (groupKey: string, subtagId: number | null) => void
  onGroupSharingChange: (groupKey: string, sharingId: number | null) => void
  onGroupPercentageChange: (groupKey: string, value: string) => void
  onToggleMapping: (groupKey: string) => void
  onToggleOverwriteSharing: (groupKey: string) => void
  onApplyGroupToRecords: (groupKey: string) => void
  onSaveGroup: (groupKey: string) => void
  onSaveVirtualGroup: (groupKey: string) => void
  onOpenDetails: (group: CuradoriaGroupedRecord) => void
  setVirtualGroupTag: (v: number | null) => void
  setVirtualGroupSubtag: (v: number | null) => void
  setVirtualReceitaTag: (v: number | null) => void
  setVirtualReceitaSubtag: (v: number | null) => void
  setVirtualGroupSharing: (v: number | null) => void
  setVirtualGroupPercentage: (v: string) => void
  setVirtualReceitaSharing: (v: number | null) => void
  setVirtualReceitaPercentage: (v: string) => void
  setOverwriteSharing: Dispatch<SetStateAction<Record<string, boolean>>>
  setHasAnyChanges: Dispatch<SetStateAction<boolean>>
  setGroupsNeedingApply: Dispatch<SetStateAction<Set<string>>>
  setGroupsWithWarning: Dispatch<SetStateAction<Set<string>>>
}

export default function CuradoriaGroupCard(props: CuradoriaGroupCardProps) {
  const {
    group,
    lineNumber,
    isSaved,
    isCurrentlySaving,
    createMappingChecked,
    needsApply,
    hasWarning,
    dropdownsDisabled,
    detectedMode,
    partners,
    virtualGroupTag,
    virtualGroupSubtag,
    virtualReceitaTag,
    virtualReceitaSubtag,
    virtualGroupSharing,
    virtualGroupPercentage,
    virtualReceitaSharing,
    virtualReceitaPercentage,
    overwriteSharing,
    getFilteredTags,
    getFilteredSubtags,
    onGroupTagChange,
    onGroupSubtagChange,
    onGroupSharingChange,
    onGroupPercentageChange,
    onToggleMapping,
    onToggleOverwriteSharing,
    onApplyGroupToRecords,
    onSaveGroup,
    onSaveVirtualGroup,
    onOpenDetails,
    setVirtualGroupTag,
    setVirtualGroupSubtag,
    setVirtualReceitaTag,
    setVirtualReceitaSubtag,
    setVirtualGroupSharing,
    setVirtualGroupPercentage,
    setVirtualReceitaSharing,
    setVirtualReceitaPercentage,
    setOverwriteSharing,
    setHasAnyChanges,
    setGroupsNeedingApply,
    setGroupsWithWarning,
  } = props

  const isVirtualGroup = group.groupKey.startsWith('virtual_')
  const isVirtualReceita = isVirtualGroup && group.tipo === 'receita'
  const canSave = isVirtualGroup
    ? isVirtualReceita
      ? virtualReceitaSubtag
      : virtualGroupSubtag
    : group.tag_id && group.subtag_id

  const shell = curadoriaGroupCardShellCls(group.tipo, isSaved)
  const tabAccentVar = curadoriaTabAccentVar(group.tipo)

  const sourceCounts = group.records.reduce(
    (acc, r) => {
      acc[r.source] = (acc[r.source] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const currentTag = isVirtualGroup
    ? isVirtualReceita
      ? virtualReceitaTag
      : virtualGroupTag
    : group.tag_id
  const currentSubtag = isVirtualGroup
    ? isVirtualReceita
      ? virtualReceitaSubtag
      : virtualGroupSubtag
    : group.subtag_id
  const currentSharing = isVirtualGroup
    ? isVirtualReceita
      ? virtualReceitaSharing
      : virtualGroupSharing
    : group.expense_sharing_id
  const currentPercentage = isVirtualGroup
    ? isVirtualReceita
      ? virtualReceitaPercentage
      : virtualGroupPercentage
    : group.ownership_percentage?.toString() || ''

  const isOverwriteEnabled = overwriteSharing[group.groupKey] ?? false
  const overwriteDisabled = currentSharing !== null || isSaved

  const markVirtualDirty = (groupKey: string) => {
    setHasAnyChanges(true)
    setGroupsNeedingApply((prev) => new Set(prev).add(groupKey))
    setGroupsWithWarning((prev) => new Set(prev).add(groupKey))
  }

  return (
    <div className={`${shell} min-w-0`} style={{ borderLeftColor: tabAccentVar }}>
      <div className="flex min-w-0 flex-wrap items-center gap-y-2 sm:flex-nowrap">
        <div
          className="flex shrink-0 items-center justify-center self-center font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500"
          style={indexLeadingStyle}
        >
          {lineNumber}
        </div>

          <div className={curadoriaItemColCls}>
            {group.tipo === 'receita' ? (
              <ArrowUp className="mt-0.5 shrink-0 text-[var(--color-success)]" size={16} aria-hidden />
            ) : (
              <ArrowDown className="mt-0.5 shrink-0 text-[var(--color-danger)]" size={16} aria-hidden />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3
                className="truncate text-sm font-semibold text-gray-900 dark:text-white"
                title={group.description}
              >
                {group.description}
              </h3>
              {(isVirtualGroup || isSaved) ? (
                <div className="flex flex-wrap items-center gap-1">
                  {isVirtualGroup ? (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                      Reagrupado
                    </span>
                  ) : null}
                  {isSaved ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-800 dark:bg-green-900/40 dark:text-green-200">
                      Salvo
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className={curadoriaStatsRowCls}>
                <span className="shrink-0">
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{group.count}</span> lanç.
                </span>
                {sourceCounts.bank ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5" style={{ color: 'var(--color-1)' }}>
                    <Landmark size={12} aria-hidden /> {sourceCounts.bank}
                  </span>
                ) : null}
                {sourceCounts.card ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5" style={{ color: 'var(--color-2)' }}>
                    <CreditCard size={12} aria-hidden /> {sourceCounts.card}
                  </span>
                ) : null}
                {sourceCounts.benefit ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5" style={{ color: 'var(--color-3)' }}>
                    <Gift size={12} aria-hidden /> {sourceCounts.benefit}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs font-medium">
                  {formatCurrencyWithColor(group.totalAmount, false)}
                </span>
              </div>
            </div>
          </div>

          <div className={curadoriaMajorDividerCls} aria-hidden />

          <div className={curadoriaFieldsRowCls}>
        <div className={`${curadoriaFieldCellCls} min-w-0 flex-1 basis-0`}>
        <CadastroFilterField label="Tag" icon={<TagIcon size={12} />} inline>
          <select
            value={currentTag || ''}
            onChange={(e) => {
              const value = e.target.value
              if (isVirtualGroup) {
                if (isVirtualReceita) {
                  setVirtualReceitaTag(value ? Number(value) : null)
                  setVirtualReceitaSubtag(null)
                } else {
                  setVirtualGroupTag(value ? Number(value) : null)
                  setVirtualGroupSubtag(null)
                }
                setHasAnyChanges(true)
              } else if (value) {
                onGroupTagChange(group.groupKey, Number(value))
              } else {
                onGroupTagChange(group.groupKey, null)
              }
            }}
            disabled={!isVirtualGroup && dropdownsDisabled}
            className={cadastroFieldCls}
          >
            <option value="">—</option>
            {getFilteredTags(group.tipo).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </CadastroFilterField>
        </div>
        <div className={`${curadoriaFieldCellCls} min-w-0 flex-1 basis-0`}>
        <CadastroFilterField label="Subtag" icon={<TagsIcon size={12} />} inline>
          <select
            value={currentSubtag || ''}
            onChange={(e) => {
              const value = e.target.value
              if (isVirtualGroup) {
                if (isVirtualReceita) {
                  setVirtualReceitaSubtag(value ? Number(value) : null)
                } else {
                  setVirtualGroupSubtag(value ? Number(value) : null)
                }
                markVirtualDirty(group.groupKey)
              } else {
                onGroupSubtagChange(group.groupKey, Number(value) || null)
              }
            }}
            disabled={isVirtualGroup ? !currentTag : !group.tag_id || dropdownsDisabled}
            className={cadastroFieldCls}
          >
            <option value="">—</option>
            {isVirtualGroup
              ? currentTag &&
                getFilteredSubtags(currentTag, group.tipo).map((subtag) => (
                  <option key={subtag.id} value={subtag.id}>
                    {subtag.name}
                  </option>
                ))
              : getFilteredSubtags(group.tag_id, group.tipo).map((subtag) => (
                  <option key={subtag.id} value={subtag.id}>
                    {subtag.name}
                  </option>
                ))}
          </select>
        </CadastroFilterField>
        </div>
        <div className={`${curadoriaFieldCellCls} min-w-0 flex-1 basis-0`}>
        <CadastroFilterField label="Compart." icon={<Users size={12} />} inline>
          <select
            value={currentSharing || ''}
            onChange={(e) => {
              const value = e.target.value
              const sharingId = value ? Number(value) : null
              if (isVirtualGroup) {
                const kind = isVirtualReceita ? 'revenue' : 'expense'
                if (isVirtualReceita) {
                  setVirtualReceitaSharing(sharingId)
                  if (sharingId) {
                    const partner = partners.find((p) => p.id === sharingId)
                    setVirtualReceitaPercentage(
                      partner ? String(sharingPercentForKind(partner, kind)) : '50',
                    )
                  } else {
                    setVirtualReceitaPercentage('')
                  }
                } else {
                  setVirtualGroupSharing(sharingId)
                  if (sharingId) {
                    const partner = partners.find((p) => p.id === sharingId)
                    setVirtualGroupPercentage(
                      partner ? String(sharingPercentForKind(partner, kind)) : '50',
                    )
                  } else {
                    setVirtualGroupPercentage('')
                  }
                }
                if (sharingId !== null) {
                  setOverwriteSharing((prev) => ({ ...prev, [group.groupKey]: true }))
                }
                markVirtualDirty(group.groupKey)
              } else {
                onGroupSharingChange(group.groupKey, sharingId)
              }
            }}
            disabled={dropdownsDisabled}
            className={cadastroFieldCls}
          >
            <option value="">Próprio</option>
            {partners.filter((p) => p.active).map((partner) => (
              <option key={partner.id} value={partner.id}>
                {sharingPartnerLabel(partner)}
              </option>
            ))}
          </select>
        </CadastroFilterField>
        </div>
        <div className={`${curadoriaFieldCellCls} w-[4.75rem] shrink-0 sm:w-[5.25rem]`}>
        <CadastroFilterField label="%" inline className="gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={currentPercentage}
            onChange={(e) => {
              const value = e.target.value
              if (isVirtualGroup) {
                if (isVirtualReceita) {
                  setVirtualReceitaPercentage(value)
                } else {
                  setVirtualGroupPercentage(value)
                }
                markVirtualDirty(group.groupKey)
              } else {
                onGroupPercentageChange(group.groupKey, value)
              }
            }}
            disabled={!currentSharing || dropdownsDisabled}
            className={`${cadastroFieldCls} w-full min-w-0 max-w-[3.25rem] px-1 py-1 text-center text-xs`}
          />
        </CadastroFilterField>
        </div>
        <div className={`${curadoriaFieldCellCls} shrink-0`}>
          <div className={curadoriaOptionsColCls}>
            <label className={`${cadastroOptionLabelCls} shrink-0 text-xs whitespace-nowrap`}>
              <input
                type="checkbox"
                checked={createMappingChecked}
                onChange={() => onToggleMapping(group.groupKey)}
                disabled={isSaved}
                className={`h-4 w-4 rounded ${cadastroAccentControlCls}`}
              />
              Criar mapeamento
            </label>
            <label className={`${cadastroOptionLabelCls} shrink-0 text-xs whitespace-nowrap`}>
              <input
                type="checkbox"
                checked={isOverwriteEnabled || currentSharing !== null}
                onChange={() => onToggleOverwriteSharing(group.groupKey)}
                disabled={overwriteDisabled}
                className={`h-4 w-4 rounded ${cadastroAccentControlCls}`}
              />
              Sobrescrever compart.
            </label>
          </div>
        </div>
          </div>

          <div className={curadoriaFieldDividerCls} aria-hidden />

          <div className="flex shrink-0 items-center gap-0.5 pl-0 sm:pl-1">
            <WriteGate>
              <button
                type="button"
                onClick={() => onApplyGroupToRecords(group.groupKey)}
                disabled={!needsApply || isSaved}
                className={`${cadastroRowIconBtnCls} relative ${hasWarning ? 'text-amber-600 dark:text-amber-400' : ''}`}
                title="Aplicar tag/subtag aos lançamentos"
              >
                <Copy size={18} />
                {hasWarning ? (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => (isVirtualGroup ? onSaveVirtualGroup(group.groupKey) : onSaveGroup(group.groupKey))}
                disabled={!canSave || isSaved || isCurrentlySaving}
                className={cadastroRowIconBtnCls}
                title={isVirtualGroup ? `Salvar mapeamento ${detectedMode}` : 'Salvar grupo'}
              >
                {isCurrentlySaving ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : isSaved ? (
                  <Check size={18} className="text-green-600" />
                ) : (
                  <Save size={18} />
                )}
              </button>
            </WriteGate>
            <button
              type="button"
              onClick={() => onOpenDetails(group)}
              className={cadastroRowIconBtnCls}
              title="Detalhes dos lançamentos"
            >
              <FileText size={18} />
            </button>
          </div>
      </div>
    </div>
  )
}
