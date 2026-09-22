import { Children, isValidElement, type ReactNode, type Ref } from 'react'
import { Filter, Plus, Search, X } from 'lucide-react'
import PageScrollRoot from './PageScrollRoot'
import Badge from './Badge'

export const cadastroListHeaderPad = 'px-6 pt-6 pb-3 lg:px-8 lg:pt-8 lg:pb-3'
export const cadastroListContentPad = 'px-6 lg:px-8'
export const cadastroListTabsPad =
  'shrink-0 bg-gray-50 px-6 pb-3 pt-3 dark:bg-gray-900 lg:px-8'

export const cadastroFilterFieldCls =
  'w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 shadow-sm transition-all focus:border-[var(--color-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-1)_25%,transparent)] dark:border-gray-600 dark:bg-gray-700 dark:text-white'

export const listPageTableSectionCls =
  'overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
export const listPageTableCls =
  'list-page-table w-full min-w-[520px] border-separate border-spacing-0 text-sm'
export const listPageTableFixedCls = `${listPageTableCls} table-fixed`
export const listPageTableChromeBgCls = 'bg-gray-100 dark:bg-gray-800/75'
export const listPageTableChromeFooterBgCls = 'bg-gray-50 dark:bg-gray-800/50'
export const listPageTableChromeHeaderCls =
  `${listPageTableChromeBgCls} [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600`
export const listPageTableThCls =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
export const listPageTableIndexThCls =
  `${listPageTableThCls} list-page-table-index-col text-center`
export const listPageTableIndexTdCls =
  'list-page-table-index-col px-0 py-3 text-center text-sm text-gray-500 dark:text-gray-400'
export const listPageTableTdCls = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300'
export const listPageTableBodyCls = 'divide-y divide-gray-200 dark:divide-gray-700/30'
export const listPageTableRowHoverCls = 'table-row-hover transition-colors'
export const listPageTableRowInactiveCls = 'opacity-55'
export const cadastroRowIconBtnCls =
  'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200'
export const cadastroRowIconDangerCls =
  'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'

export type StatusFilter = 'all' | 'active' | 'inactive'
export const listPageTableChromeFooterCls =
  `border-t-2 border-gray-200 ${listPageTableChromeFooterBgCls} px-6 py-4 dark:border-gray-600`

export const cadastroFilterGridCls = 'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4'
export const cadastroFilterFlexRowCls =
  'flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-1'

function countFilterChildren(children: ReactNode): number {
  return Children.toArray(children).filter(isValidElement).length
}

function resolveFilterRowCls(childCount: number, gridClass?: string): string {
  if (gridClass) return gridClass
  if (childCount <= 3) return cadastroFilterFlexRowCls
  return cadastroFilterGridCls
}

export function CadastroListPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {children}
    </div>
  )
}

export function CadastroListPageHero({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode
  title: string
  subtitle: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-900 dark:text-white">
          <span className="shrink-0 text-[var(--color-1)]">{icon}</span>
          {title}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{subtitle}</p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

export function CadastroListCreateButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
    >
      <Plus size={18} /> {label}
    </button>
  )
}

export function CadastroFilterField({
  label,
  icon,
  children,
  className,
}: {
  label: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
        {icon ? <span className="inline-flex shrink-0 text-[var(--color-1)]">{icon}</span> : null}
        {label}
      </label>
      {children}
    </div>
  )
}

export function CadastroListPageFilterCard({
  hasActiveFilters,
  onClearFilters,
  onApply,
  applying = false,
  resultHint,
  gridClass,
  children,
}: {
  hasActiveFilters: boolean
  onClearFilters: () => void
  onApply: () => void
  applying?: boolean
  resultHint?: ReactNode
  gridClass?: string
  children?: ReactNode
}) {
  const filterCount = children ? countFilterChildren(children) : 0
  const rowCls = resolveFilterRowCls(filterCount, gridClass)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-[var(--color-1)] hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200">
          <Filter size={18} className="text-[var(--color-1)]" />
          Filtros
          {resultHint ? <Badge variant="filter">{resultHint}</Badge> : null}
        </h3>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="flex shrink-0 items-center gap-1.5 text-sm font-semibold transition-all hover:opacity-80"
            style={{ color: 'var(--color-1)' }}
          >
            <X size={14} /> Limpar filtros
          </button>
        ) : null}
      </div>

      <div className="flex w-full items-end gap-3">
        {children ? (
          <div className={`min-w-0 flex-1 ${rowCls}`}>{children}</div>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden />
        )}
        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
        >
          <Filter size={14} />
          Aplicar
        </button>
      </div>
    </div>
  )
}

export function CadastroListPageSearchField({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter?: () => void
}) {
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.()
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-800 outline-none transition-all focus:border-[var(--color-1)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-1)_25%,transparent)] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}

export type CadastroListTab<T extends string = string> = {
  key: T
  label: string
  count?: number
  icon?: ReactNode
}

export function CadastroListPageTabs<T extends string>({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: CadastroListTab<T>[]
  active: T
  onChange: (key: T) => void
  trailing?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
            active === tab.key
              ? 'border-[var(--color-1)] text-[var(--color-1)]'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.count != null ? (
            <Badge variant="tab" tone="brand1" className="bg-[var(--color-1)] text-[var(--on-color-1)]">
              {tab.count}
            </Badge>
          ) : null}
        </button>
      ))}
      {trailing ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 self-center pb-2">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

export function CadastroListPageEmptyCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-full bg-gray-100 p-4 dark:bg-gray-700">{icon}</div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        {action}
      </div>
    </div>
  )
}

export function CadastroListPageLoading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-[var(--color-1)] dark:border-gray-700" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  )
}

export function CadastroListPageBody({
  header,
  tabs,
  children,
  scroll = true,
  scrollRef,
  contentOverflow = 'vertical-only',
  pinTabs = false,
}: {
  header: ReactNode
  tabs?: ReactNode
  children: ReactNode
  scroll?: boolean
  scrollRef?: Ref<HTMLDivElement>
  contentOverflow?: 'vertical-only' | 'auto'
  /** Quando true, abas/filtros ficam travados abaixo do título. Default: só o título fica travado. */
  pinTabs?: boolean
}) {
  const pinChrome = Boolean(tabs) && pinTabs
  const bodyPad = tabs ? `${cadastroListContentPad} pt-3` : `${cadastroListContentPad} pt-4`
  const scrollX = contentOverflow === 'auto' ? 'overflow-x-auto' : 'overflow-x-hidden'
  const tabsNode = tabs ? (
    pinChrome ? (
      <div className={cadastroListTabsPad}>{tabs}</div>
    ) : (
      <div className="mb-4">{tabs}</div>
    )
  ) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={`shrink-0 bg-gray-50 dark:bg-gray-900 ${cadastroListHeaderPad}`}>{header}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-gray-200 dark:border-gray-700">
        {pinChrome ? tabsNode : null}
        {scroll ? (
          <PageScrollRoot
            ref={scrollRef}
            className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${scrollX} scroll-slim bg-gray-50 pb-20 dark:bg-gray-900 ${bodyPad}`}
          >
            {pinChrome ? null : tabsNode}
            {children}
          </PageScrollRoot>
        ) : (
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 pb-4 dark:bg-gray-900 ${bodyPad}`}>
            {pinChrome ? null : tabsNode}
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
