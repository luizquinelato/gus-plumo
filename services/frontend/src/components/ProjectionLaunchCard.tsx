import type { DragEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { listPageTableSectionCls } from './CadastroListPageLayout'
import { ProjectionOriginBadge, type ProjectionSource } from './ProjectionOriginBadge'
import ProjectionItemDeleteButton from './ProjectionItemDeleteButton'

type Tone = 'income' | 'fixed' | 'variable'

type Props = {
  source: ProjectionSource
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
  const income = tone === 'income'
  const accentVar = income ? 'var(--color-success)' : 'var(--color-danger)'
  const flowLabel = income ? 'Entrada' : 'Saída'
  const flowHint =
    tone === 'fixed' ? 'Despesa fixa' : tone === 'variable' ? 'Despesa variável' : undefined
  const iconSize = compact ? 12 : 14
  /** Calendário portal usa compact; no mobile o mesmo modo ganha padding/tipo um pouco maiores. */
  const headerPad = compact
    ? 'gap-2 px-3 py-2 max-md:gap-2.5 max-md:px-3.5 max-md:py-2.5'
    : 'gap-3 px-5 py-3'
  const iconBox = compact
    ? 'h-8 w-8 rounded-md max-md:h-9 max-md:w-9'
    : 'h-10 w-10 rounded-lg'
  const bodyPad = compact ? 'px-3 py-2 max-md:px-3.5 max-md:py-2.5' : 'px-5 py-4'

  return (
    <div className="group/item relative">
      <button
        type="button"
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onOpen}
        title={title}
        className={`${listPageTableSectionCls} flex w-full touch-manipulation flex-col overflow-hidden text-left transition-all hover:border-[var(--color-1)] active:border-[var(--color-1)]`}
      >
        <div
          className={`flex items-start border-b border-l-4 border-gray-200 dark:border-gray-600 ${headerPad} pr-7`}
          style={{ borderLeftColor: accentVar }}
        >
          <div
            className={`flex shrink-0 items-center justify-center ring-1 ring-[color-mix(in_srgb,var(--color-1)_20%,transparent)] ${iconBox}`}
            style={{
              color: accentVar,
              background: `color-mix(in srgb, ${accentVar} 14%, transparent)`,
            }}
          >
            {income ? (
              <ArrowDownLeft size={compact ? 14 : 18} className="shrink-0" aria-hidden />
            ) : (
              <ArrowUpRight size={compact ? 14 : 18} className="shrink-0" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`font-bold leading-snug text-gray-900 dark:text-white ${
                compact ? 'line-clamp-2 text-xs max-md:text-[13px]' : 'line-clamp-3 text-sm'
              }`}
            >
              {description}
            </p>
          </div>
        </div>
        <div
          className={`flex flex-col justify-center border-l-4 border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800 ${bodyPad} ${compact ? '' : 'min-h-[5.5rem]'}`}
          style={{ borderLeftColor: accentVar }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            {income ? (
              <ArrowDownLeft size={iconSize} className="shrink-0 text-[var(--color-success)]" aria-hidden />
            ) : (
              <ArrowUpRight size={iconSize} className="shrink-0 text-[var(--color-danger)]" aria-hidden />
            )}
            <span
              className={`font-semibold uppercase tracking-wide ${compact ? 'text-[9px] max-md:text-[10px]' : 'text-xs'}`}
            >
              {flowLabel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div
              className={`min-w-0 shrink font-bold tabular-nums ${
                compact ? 'text-sm max-md:text-base' : 'text-xl sm:text-2xl'
              }`}
              style={{ color: accentVar }}
            >
              {amount}
            </div>
            <div className="shrink-0">
              <ProjectionOriginBadge source={source} />
            </div>
          </div>
          {flowHint ? (
            <p className={`mt-1 text-gray-500 dark:text-gray-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              {flowHint}
            </p>
          ) : null}
        </div>
      </button>
      <ProjectionItemDeleteButton label={description} disabled={deleting} onDelete={onDelete} />
    </div>
  )
}