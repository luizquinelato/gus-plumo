import type { DragEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { listPageTableSectionCls } from './CadastroListPageLayout'
import {
  ProjectionOriginBadges,
  projectionOriginAccentColor,
  type ProjectionSource,
} from './ProjectionOriginBadge'
import ProjectionItemDeleteButton from './ProjectionItemDeleteButton'
import { usePageWriteAllowed } from '../contexts/PageMutationContext'

type Tone = 'income' | 'fixed' | 'variable'

type Props = {
  source: ProjectionSource
  /** Folha com vínculo em bank_statements (match no extrato). */
  linkedExtrato?: boolean
  description: string
  amount: string
  tone: Tone
  compact?: boolean
  title?: string
  draggable?: boolean
  deleting?: boolean
  onOpen: () => void
  onDelete: () => void
  onDragStart?: (ev: DragEvent<HTMLButtonElement>) => void
}

/** Lançamento no calendário: mesmo esqueleto dos painéis Cartão / Benefício (Home). */
export default function ProjectionLaunchCard({
  source,
  linkedExtrato = false,
  description,
  amount,
  tone,
  compact = false,
  title,
  draggable,
  deleting,
  onOpen,
  onDelete,
  onDragStart,
}: Props) {
  const canWrite = usePageWriteAllowed()
  const income = tone === 'income'
  const allowDrag = Boolean(draggable && canWrite)
  const accentVar = income ? 'var(--color-success)' : 'var(--color-danger)'
  const flowIconCls = income
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
  const originColor = projectionOriginAccentColor(source)
  const flowLabel = income ? 'Entrada' : 'Saída'
  const flowHint =
    tone === 'fixed' ? 'Despesa fixa' : tone === 'variable' ? 'Despesa variável' : undefined
  const flowIconSize = compact ? 16 : 20
  /** Calendário portal usa compact; no mobile o mesmo modo ganha padding/tipo um pouco maiores. */
  const headerPad = compact
    ? 'px-3 py-2 max-md:px-3.5 max-md:py-2.5'
    : 'px-5 py-3'
  const bodyPad = compact ? 'px-3 py-2 max-md:px-3.5 max-md:py-2.5' : 'px-5 py-4'

  return (
    <div className="group/item relative">
      <button
        type="button"
        draggable={allowDrag}
        onDragStart={allowDrag ? onDragStart : undefined}
        onClick={onOpen}
        title={title}
        className={`${listPageTableSectionCls} flex w-full touch-manipulation flex-col overflow-hidden text-left transition-all hover:border-[var(--color-1)] active:border-[var(--color-1)]`}
      >
        <div
          className={`border-b border-l-4 border-gray-200 dark:border-gray-600 ${headerPad} pr-7`}
          style={{ borderLeftColor: originColor }}
        >
          <p
            className={`font-bold leading-snug text-gray-900 dark:text-white ${
              compact ? 'line-clamp-2 text-xs max-md:text-[13px]' : 'line-clamp-3 text-sm'
            }`}
          >
            {description}
          </p>
        </div>
        <div
          className={`flex flex-col justify-center border-l-4 border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800 ${bodyPad} ${compact ? '' : 'min-h-[5.5rem]'}`}
          style={{ borderLeftColor: originColor }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            {income ? (
              <ArrowDownCircle size={flowIconSize} className={`shrink-0 ${flowIconCls}`} aria-hidden />
            ) : (
              <ArrowUpCircle size={flowIconSize} className={`shrink-0 ${flowIconCls}`} aria-hidden />
            )}
            <span
              className={`font-semibold uppercase tracking-wide ${compact ? 'text-[9px] max-md:text-[10px]' : 'text-xs'}`}
            >
              {flowLabel}
            </span>
          </div>
          <div
            className={`min-w-0 font-bold tabular-nums ${
              compact ? 'text-sm max-md:text-base' : 'text-xl sm:text-2xl'
            }`}
            style={{ color: accentVar }}
          >
            {amount}
          </div>
          <div
            className={`mt-1 flex min-h-[1.125rem] items-end justify-end gap-2 ${
              flowHint ? 'justify-between' : ''
            }`}
          >
            {flowHint ? (
              <p className={`min-w-0 text-gray-500 dark:text-gray-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
                {flowHint}
              </p>
            ) : null}
            <div className="shrink-0">
              <ProjectionOriginBadges source={source} linkedExtrato={linkedExtrato} />
            </div>
          </div>
        </div>
      </button>
      <ProjectionItemDeleteButton label={description} disabled={deleting} onDelete={onDelete} />
    </div>
  )
}