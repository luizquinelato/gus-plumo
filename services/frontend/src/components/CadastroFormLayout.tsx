import { Children, createContext, isValidElement, useContext, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Pencil, Plus, Save, X } from 'lucide-react'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageShell,
} from './CadastroListPageLayout'
import Badge from './Badge'

export const cadastroFieldCls =
  'w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)] [color-scheme:light] dark:[color-scheme:dark]'

export const cadastroAccentControlCls =
  'accent-[var(--color-1)] [color-scheme:light] dark:[color-scheme:dark]'

export const cadastroOptionLabelCls =
  'flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-100'

export const cadastroSectionsStackCls = 'flex flex-col gap-4'

export const cadastroSectionCardCls =
  'overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.1),0_1px_4px_rgba(15,23,42,0.06)] dark:border-gray-600 dark:bg-gray-800 dark:shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-[box-shadow,border-color] duration-200 hover:border-[var(--color-1)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_6px_24px_rgba(0,0,0,0.55)]'

const cadastroSectionHeadBarBaseCls =
  'flex items-center justify-between gap-3 border-b border-gray-200 bg-slate-100 py-2.5 text-left dark:border-gray-700 dark:bg-gray-900/80'

export const cadastroSectionHeadBarCls = `${cadastroSectionHeadBarBaseCls} pl-3.5 pr-4`
export const cadastroSectionBodyCls = 'px-4 py-3 text-left'

export const cadastroRequiredHint = (
  <>
    <span className="text-red-500">*</span> campos obrigatórios
  </>
)

export type CadastroSectionAccent = 'primary' | 'info' | 'muted'

const CadastroModalFlatContext = createContext(false)

export function CadastroModalLayoutProvider({
  flat = true,
  children,
}: {
  flat?: boolean
  children: ReactNode
}) {
  return (
    <CadastroModalFlatContext.Provider value={flat}>
      {children}
    </CadastroModalFlatContext.Provider>
  )
}

function useCadastroModalFlat(explicit?: boolean) {
  const inherited = useContext(CadastroModalFlatContext)
  return explicit ?? inherited
}

function sectionHeadAccentCls(accent?: CadastroSectionAccent, muted?: boolean): string {
  if (muted || accent === 'muted') return 'border-l-[3px] border-l-gray-400 dark:border-l-gray-500'
  if (accent === 'info') return 'border-l-[3px] border-l-[var(--color-info)]'
  return 'border-l-[3px] border-l-[var(--color-1)]'
}

export function CadastroSectionHead({
  title,
  icon,
  trailing,
  muted,
  accent,
}: {
  title: ReactNode
  icon?: ReactNode
  muted?: boolean
  accent?: CadastroSectionAccent
  trailing?: ReactNode
}) {
  const iconCls = muted || accent === 'muted'
    ? 'shrink-0 text-gray-500 dark:text-gray-400'
    : accent === 'info'
      ? 'shrink-0 text-[var(--color-info)]'
      : 'shrink-0 text-[var(--color-1)]'
  return (
    <div className={`${cadastroSectionHeadBarCls} ${sectionHeadAccentCls(accent, muted)}`.trim()}>
      <div className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-300">
        {icon ? <span className={iconCls}>{icon}</span> : null}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300">
          {title}
        </span>
      </div>
      {trailing}
    </div>
  )
}

export const cadastroModalSectionCls = 'mt-5 first:mt-0'
export const cadastroModalSectionBodyInsetCls = 'px-3'
export const cadastroModalSectionHeadBarCls = `${cadastroSectionHeadBarCls} -mx-3 mb-3`
export const cadastroModalFieldsGridCls = 'divide-y divide-gray-300 dark:divide-gray-600'
export const cadastroModalFieldsDivideXCls = 'divide-x divide-gray-300 dark:divide-gray-600'
export const cadastroModalFieldsRowCls = 'py-3'

const MODAL_FIELDS_COLS_CLS: Record<2 | 3 | 4 | 5, string> = {
  2: 'grid grid-cols-2',
  3: 'grid grid-cols-3',
  4: 'grid grid-cols-4',
  5: 'grid grid-cols-5',
}

const MODAL_FIELDS_CELL_PAD: Record<2 | 3 | 4 | 5, string[]> = {
  2: ['py-3 pr-4', 'py-3 pl-4'],
  3: ['py-3 pr-3', 'py-3 px-3', 'py-3 pl-3'],
  4: ['py-3 pr-3', 'py-3 px-2', 'py-3 px-2', 'py-3 pl-3'],
  5: ['py-3 pr-2', 'py-3 px-1.5', 'py-3 px-1.5', 'py-3 px-1.5', 'py-3 pl-2'],
}

export function CadastroModalFieldsGrid({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${cadastroModalFieldsGridCls} ${className}`.trim()}>{children}</div>
}

export function CadastroModalFieldsRow({
  children,
  cols = 1,
  className = '',
}: {
  children: ReactNode
  cols?: 1 | 2 | 3 | 4 | 5
  className?: string
}) {
  if (cols === 1) {
    return <div className={`${cadastroModalFieldsRowCls} ${className}`.trim()}>{children}</div>
  }
  const pads = MODAL_FIELDS_CELL_PAD[cols]
  const items = Children.toArray(children).filter(isValidElement)
  return (
    <div className={`${MODAL_FIELDS_COLS_CLS[cols]} ${cadastroModalFieldsDivideXCls} ${className}`.trim()}>
      {items.map((child, i) => (
        <div key={i} className={pads[i] ?? pads[pads.length - 1]}>
          {child}
        </div>
      ))}
    </div>
  )
}

export function CadastroModalSectionHead({
  title,
  icon,
  trailing,
  muted,
  accent,
  titleClassName,
}: {
  title: ReactNode
  icon?: ReactNode
  muted?: boolean
  accent?: CadastroSectionAccent
  trailing?: ReactNode
  titleClassName?: string
}) {
  const titleCls = titleClassName
    ?? 'text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300'
  const iconCls = muted || accent === 'muted'
    ? 'shrink-0 text-gray-500 dark:text-gray-400'
    : accent === 'info'
      ? 'shrink-0 text-[var(--color-info)]'
      : 'shrink-0 text-[var(--color-1)]'
  return (
    <div className={`${cadastroModalSectionHeadBarCls} ${sectionHeadAccentCls(accent, muted)}`.trim()}>
      <div className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-300">
        {icon ? <span className={iconCls}>{icon}</span> : null}
        <span className={`min-w-0 truncate ${titleCls}`.trim()}>{title}</span>
      </div>
      {trailing}
    </div>
  )
}

export function CadastroModalSection({
  title,
  hint,
  icon,
  muted,
  accent,
  trailing,
  children,
  className = '',
  bodyClassName = '',
  titleClassName,
}: {
  title: string
  hint?: ReactNode
  icon?: ReactNode
  muted?: boolean
  accent?: CadastroSectionAccent
  trailing?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  titleClassName?: string
}) {
  const hintPad = /\bp-0\b/.test(bodyClassName) ? ' px-3 pt-0' : ''
  return (
    <section className={`${cadastroModalSectionCls} ${className}`.trim()}>
      <CadastroModalSectionHead
        title={title}
        icon={icon}
        trailing={trailing}
        accent={accent}
        muted={muted}
        titleClassName={titleClassName}
      />
      <div className={`${cadastroModalSectionBodyInsetCls} ${bodyClassName}`.trim()}>
        {hint && (
          <p className={`mb-3 text-left text-[11px] leading-snug text-gray-500 dark:text-gray-400${hintPad}`}>
            {hint}
          </p>
        )}
        {children}
      </div>
    </section>
  )
}

export function CadastroFormSection({
  title,
  hint,
  icon,
  muted,
  accent,
  trailing,
  children,
  className = '',
  bodyClassName = '',
  titleClassName,
  flat,
}: {
  title: string
  hint?: ReactNode
  icon?: ReactNode
  muted?: boolean
  accent?: CadastroSectionAccent
  trailing?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  titleClassName?: string
  flat?: boolean
}) {
  const useFlat = useCadastroModalFlat(flat)
  if (useFlat) {
    return (
      <CadastroModalSection
        title={title}
        hint={hint}
        icon={icon}
        muted={muted}
        accent={accent}
        trailing={trailing}
        className={className}
        bodyClassName={bodyClassName}
        titleClassName={titleClassName}
      >
        {children}
      </CadastroModalSection>
    )
  }
  return (
    <section className={`${cadastroSectionCardCls} ${className}`.trim()}>
      <CadastroSectionHead title={title} icon={icon} trailing={trailing} accent={accent} muted={muted} />
      <div className={`${cadastroSectionBodyCls} ${bodyClassName}`.trim()}>
        {hint && (
          <p
            className={`mb-3 text-left text-[11px] leading-snug text-gray-500 dark:text-gray-400${
              /\bp-0\b/.test(bodyClassName) ? ' px-4 pt-3' : ''
            }`}
          >
            {hint}
          </p>
        )}
        {children}
      </div>
    </section>
  )
}

export type CadastroModalTabDef<T extends string = string> = {
  key: T
  label: string
  icon?: ReactNode
  badge?: number
  disabled?: boolean
  title?: string
}

export function CadastroModalTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
  className = '',
  barClassName = '',
}: {
  tabs: CadastroModalTabDef<T>[]
  active: T
  onChange: (key: T) => void
  ariaLabel: string
  className?: string
  barClassName?: string
}) {
  return (
    <div className={className.trim() || undefined}>
      <div
        className={`flex shrink-0 border-b border-gray-200 dark:border-gray-600 ${barClassName}`.trim()}
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            disabled={t.disabled}
            title={t.title}
            onClick={() => onChange(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
              t.disabled ? 'cursor-not-allowed opacity-40' : ''
            } ${
              active === t.key
                ? 'text-[var(--color-1)] border-b-2 border-[var(--color-1)] -mb-px bg-white dark:bg-gray-800'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.icon ? <span className="shrink-0 opacity-90">{t.icon}</span> : null}
            {t.label}
            {t.badge != null && t.badge > 0 ? (
              <Badge variant="tab" tone="brand1" className="bg-[var(--color-1)] text-[var(--on-color-1)]">
                {t.badge}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CadastroFieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </span>
  )
}

export type CadastroModalBreadcrumbSegment = {
  label: string
  onClick?: () => void
}

export function CadastroModalBreadcrumbTitle({
  segments,
  disabled = false,
  className = '',
}: {
  segments: CadastroModalBreadcrumbSegment[]
  disabled?: boolean
  className?: string
}) {
  if (segments.length === 0) return null
  return (
    <nav
      aria-label="Navegação"
      className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-lg font-bold ${className}`.trim()}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        const clickable = !!seg.onClick && !isLast && !disabled
        return (
          <span key={`${seg.label}-${i}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            {i > 0 && (
              <ChevronRight size={14} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
            )}
            {clickable ? (
              <button
                type="button"
                onClick={seg.onClick}
                className="truncate text-gray-500 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
              >
                {seg.label}
              </button>
            ) : (
              <span
                className={`truncate ${
                  isLast ? 'text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {seg.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function CadastroModalShell({
  children,
  maxWidth = 'max-w-5xl',
  maxHeight = 'max-h-[92vh]',
  onBackdropClick,
  zClass = 'z-[100]',
}: {
  children: ReactNode
  maxWidth?: string
  maxHeight?: string
  onBackdropClick?: () => void
  zClass?: string
}) {
  return createPortal(
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/40 p-4`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        onBackdropClick?.()
      }}
    >
      <div
        className={`flex ${maxHeight} w-full ${maxWidth} flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-800`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function CadastroModalHeader({
  isEdit,
  title,
  titleAddon,
  subtitle,
  onClose,
  breadcrumb,
  hideClose = false,
  icon,
  iconStyle,
}: {
  isEdit: boolean
  title?: string
  /** Conteúdo ao lado do título (ex.: badge de status). */
  titleAddon?: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  breadcrumb?: CadastroModalBreadcrumbSegment[]
  hideClose?: boolean
  icon?: ReactNode
  iconStyle?: CSSProperties
}) {
  const defaultIconStyle: CSSProperties = {
    backgroundColor: isEdit ? 'var(--color-edit)' : 'var(--color-create)',
    color: isEdit ? 'var(--on-color-edit)' : 'var(--on-color-create)',
  }
  return (
    <div className="shrink-0 border-b border-gray-200 px-6 pb-3 pt-6 text-left dark:border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className="flex shrink-0 items-center justify-center rounded-lg p-2"
            style={iconStyle ?? defaultIconStyle}
          >
            {icon ?? (isEdit ? <Pencil size={18} /> : <Plus size={18} />)}
          </div>
          <div className="min-w-0 flex-1">
            {breadcrumb && breadcrumb.length > 0 ? (
              <CadastroModalBreadcrumbTitle segments={breadcrumb} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{title}</h2>
                {titleAddon}
              </div>
            )}
            {subtitle != null && (
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
        </div>
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={20} />
          </button>
        )}
      </div>
    </div>
  )
}

export function CadastroModalBody({
  children,
  chrome,
  divided = true,
  flat = true,
  scrollable = true,
}: {
  children: ReactNode
  /** Abas e filtros que ficam travados acima do conteúdo com scroll. */
  chrome?: ReactNode
  divided?: boolean
  flat?: boolean
  scrollable?: boolean
}) {
  const wrapCls = flat ? 'flex flex-col' : divided ? cadastroSectionsStackCls : ''
  const inner = wrapCls ? (
    <div className={`${wrapCls}${scrollable && !chrome ? '' : ' min-h-0 flex-1 flex flex-col'}`}>{children}</div>
  ) : scrollable && !chrome ? (
    children
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">{children}</div>
  )
  return (
    <CadastroModalLayoutProvider flat={flat}>
      {chrome ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 pt-4 text-left">
          <div className="shrink-0 bg-white dark:bg-gray-800">{chrome}</div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-slim pb-4">{inner}</div>
        </div>
      ) : (
        <div
          className={`min-h-0 min-w-0 flex-1 px-6 py-4 text-left ${
            scrollable ? 'overflow-y-auto overflow-x-hidden scroll-slim' : 'flex flex-col overflow-hidden'
          }`}
        >
          {inner}
        </div>
      )}
    </CadastroModalLayoutProvider>
  )
}

export function CadastroModalFooter({
  onClose,
  onSave,
  saving = false,
  disabled = false,
  saveLabel = 'Salvar',
  closeLabel = 'Cancelar',
  hideSave = false,
  leading,
  secondaryActions,
  saveIcon,
  saveTone = 'default',
}: {
  onClose: () => void
  onSave?: () => void
  saving?: boolean
  disabled?: boolean
  saveLabel?: string
  closeLabel?: string
  hideSave?: boolean
  leading?: ReactNode
  secondaryActions?: ReactNode
  saveIcon?: ReactNode
  saveTone?: 'default' | 'success' | 'danger'
}) {
  const blocked = saving || disabled
  const hasLeading = leading != null && leading !== false
  const saveStyle =
    saveTone === 'success'
      ? { background: 'var(--color-success)', color: 'var(--on-color-success)' }
      : saveTone === 'danger'
        ? { background: 'var(--color-delete)', color: 'var(--on-color-delete)' }
        : { background: 'var(--color-save)', color: 'var(--on-color-save)' }
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700 ${
        hasLeading ? 'justify-between' : 'justify-end'
      }`}
    >
      {hasLeading ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
      ) : null}
      <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${hasLeading ? 'ml-auto' : 'w-full'}`}>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-cancel)' }}
        >
          {closeLabel}
        </button>
        {secondaryActions}
        {!hideSave && onSave ? (
          <button
            type="button"
            onClick={onSave}
            disabled={blocked}
            className="inline-flex items-center gap-2 rounded-lg border-none px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            style={saveStyle}
          >
            {saveIcon ?? <Save size={15} className={saving ? 'animate-spin' : undefined} />}
            {saveLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export const listPageSectionCls =
  'overflow-clip rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800'

export function ListPageSection({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`${listPageSectionCls} ${className}`.trim()}>{children}</section>
}

export function SettingsPageLayout({
  icon,
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  loading?: boolean
  children: ReactNode
}) {
  return (
    <CadastroListPageShell>
      <CadastroListPageBody
        header={
          <CadastroListPageHero
            icon={icon}
            title={title}
            subtitle={subtitle ?? ''}
            actions={actions}
          />
        }
      >
        {loading ? (
          <CadastroListPageLoading />
        ) : (
          <div className="flex w-full max-w-none flex-col gap-4">{children}</div>
        )}
      </CadastroListPageBody>
    </CadastroListPageShell>
  )
}

export function SettingsPanelShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <ListPageSection className={className}>
      <CadastroModalLayoutProvider flat>
        <div className="px-4 py-4 text-gray-800 sm:px-5 sm:py-5 dark:text-gray-100">{children}</div>
      </CadastroModalLayoutProvider>
    </ListPageSection>
  )
}

export function SettingsSaveButton({
  onClick,
  disabled,
  saving,
  label = 'Salvar',
}: {
  onClick: () => void
  disabled?: boolean
  saving?: boolean
  label?: string
}) {
  const active = !disabled && !saving
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed whitespace-nowrap disabled:opacity-50"
      style={{
        background: active ? 'var(--color-save)' : '#e2e8f0',
        color: active ? 'var(--on-color-save)' : '#94a3b8',
        opacity: saving ? 0.6 : 1,
      }}
    >
      <Save size={18} className={saving ? 'animate-spin' : undefined} />
      {saving ? 'Salvando…' : label}
    </button>
  )
}
