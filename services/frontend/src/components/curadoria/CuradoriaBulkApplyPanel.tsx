import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Copy, Tag as TagIcon, Tags as TagsIcon, Users } from 'lucide-react'
import {
  CadastroListPrimaryButton,
  cadastroFilterFieldCls,
  listPageTableSectionCls,
} from '../CadastroListPageLayout'
import type { CuradoriaPartner, CuradoriaSubtag, CuradoriaTag } from './curadoriaTypes'
import { sharingPartnerLabel, sharingPercentForKind } from '../../utils/accountFormatter'

type Tipo = 'receita' | 'despesa'

function BulkPanelHeader({
  accentVar,
  icon,
  title,
  subtitle,
}: {
  accentVar: string
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-l-4 border-gray-200 px-4 py-2.5 dark:border-gray-600"
      style={{ borderLeftColor: accentVar }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-[color-mix(in_srgb,var(--color-1)_20%,transparent)]"
        style={{
          color: accentVar,
          background: `color-mix(in srgb, ${accentVar} 14%, transparent)`,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  )
}

function BulkPanelFieldCell({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col justify-center bg-white px-4 py-2.5 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {children}
    </div>
  )
}

export interface CuradoriaBulkApplyPanelProps {
  tipo: Tipo
  tagId: number | null
  subtagId: number | null
  sharingId: number | null
  onTagChange: (id: number | null) => void
  onSubtagChange: (id: number | null) => void
  onSharingChange: (sharingId: number | null, defaultPct: string) => void
  onApply: () => void
  partners: CuradoriaPartner[]
  getFilteredTags: (tipo: Tipo) => CuradoriaTag[]
  getFilteredSubtags: (tagId: number | null, tipo: Tipo) => CuradoriaSubtag[]
}

export default function CuradoriaBulkApplyPanel(props: CuradoriaBulkApplyPanelProps) {
  const {
    tipo,
    tagId,
    subtagId,
    sharingId,
    onTagChange,
    onSubtagChange,
    onSharingChange,
    onApply,
    partners,
    getFilteredTags,
    getFilteredSubtags,
  } = props

  const isReceita = tipo === 'receita'
  const accentVar = isReceita ? 'var(--color-success)' : 'var(--color-danger)'
  const HeaderIcon = isReceita ? ArrowUp : ArrowDown
  const kind = isReceita ? 'revenue' : 'expense'

  return (
    <div className="px-4 pb-3 pt-0">
      <article className={`${listPageTableSectionCls} flex flex-col overflow-hidden`}>
        <BulkPanelHeader
          accentVar={accentVar}
          icon={<HeaderIcon size={16} aria-hidden />}
          title="Aplicar a todos os grupos"
          subtitle={
            isReceita
              ? 'Receitas desta aba'
              : 'Despesas desta aba'
          }
        />
        <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:divide-x sm:divide-y-0">
          <BulkPanelFieldCell
            label="Tag"
            icon={<TagIcon size={12} className="text-[var(--color-1)]" />}
          >
            <select
              value={tagId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onTagChange(v === '' ? null : Number(v))
              }}
              className={cadastroFilterFieldCls}
            >
              <option value="">Selecione...</option>
              {getFilteredTags(tipo).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </BulkPanelFieldCell>
          <BulkPanelFieldCell
            label="Subtag"
            icon={<TagsIcon size={12} className="text-[var(--color-1)]" />}
          >
            <select
              value={subtagId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onSubtagChange(v === '' ? null : Number(v))
              }}
              disabled={!tagId}
              className={cadastroFilterFieldCls}
            >
              <option value="">Selecione...</option>
              {getFilteredSubtags(tagId, tipo).map((subtag) => (
                <option key={subtag.id} value={subtag.id}>
                  {subtag.name}
                </option>
              ))}
            </select>
          </BulkPanelFieldCell>
          <BulkPanelFieldCell
            label="Compart."
            icon={<Users size={12} className="text-[var(--color-1)]" />}
          >
            <select
              value={sharingId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                const id = v ? Number(v) : null
                if (id) {
                  const partner = partners.find((p) => p.id === id)
                  onSharingChange(id, partner ? String(sharingPercentForKind(partner, kind)) : '50')
                } else {
                  onSharingChange(null, '')
                }
              }}
              className={cadastroFilterFieldCls}
            >
              <option value="">Opcional</option>
              {partners.filter((p) => p.active).map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {sharingPartnerLabel(partner)}
                </option>
              ))}
            </select>
          </BulkPanelFieldCell>
          <div className="flex flex-col justify-center bg-white px-4 py-2.5 dark:bg-gray-800 sm:min-w-[7.5rem]">
            <div className="mb-1 flex h-[18px] items-center gap-1.5 sm:invisible" aria-hidden>
              <span className="text-xs font-medium">&nbsp;</span>
            </div>
            <div className="w-full sm:w-auto">
              <CadastroListPrimaryButton
                label="Aplicar"
                onClick={onApply}
                disabled={!tagId || !subtagId}
                icon={<Copy size={16} />}
              />
            </div>
          </div>
        </div>
        <p className="border-t border-gray-200 bg-gray-50 px-4 py-1.5 text-[11px] leading-snug text-gray-500 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
          Preenche os grupos desta aba; salvar continua sendo por grupo ou &quot;Salvar todos&quot;.
        </p>
      </article>
    </div>
  )
}
