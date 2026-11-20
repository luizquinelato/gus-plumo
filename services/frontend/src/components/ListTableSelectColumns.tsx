import type { CSSProperties, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import BulkSelectCheckbox from './BulkSelectCheckbox'
import { usePageWriteAllowed } from '../contexts/PageMutationContext'
import type { HeaderCheckState } from './BulkSelectCheckbox'

/**
 * Larguras fixas das colunas líderes (checkbox + `#`).
 * Usar SEMPRE estes valores — em `<table>`, card-list e tree-list —
 * para que checkbox e `#` fiquem na mesma posição em todas as páginas.
 * CSS: `index.css` (`.list-page-table-*-col`) + `ListTableLeadingColgroup` no `ListPageTable`.
 */
export const LIST_TABLE_CHECKBOX_COL_PX = 40
export const LIST_TABLE_INDEX_COL_PX = 40
export const LIST_TABLE_DRAG_COL_PX = 36
export const LIST_TABLE_LEADING_ROW_PX = 48
export const LIST_TABLE_SPACER_COL_PX = 4
export const LIST_TABLE_EXPAND_COL_PX = 28

export const listPageTableCheckboxColCls = 'list-page-table-checkbox-col'
export const listPageTableCheckboxThCls =
  'list-page-table-checkbox-col box-border shrink-0 p-0 align-middle text-center'
export const listPageTableCheckboxTdCls =
  'list-page-table-checkbox-col box-border shrink-0 p-0 align-middle text-center'

export const listPageTableIndexColCls = 'list-page-table-index-col'
export const listPageTableIndexThCls =
  'list-page-table-index-col box-border shrink-0 p-0 align-middle text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'
export const listPageTableIndexTdCls =
  'list-page-table-index-col box-border shrink-0 p-0 align-middle text-center font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500'
export const listPageTableSpacerThCls = 'list-page-table-spacer w-1 p-0'
export const listPageTableSpacerTdCls = 'list-page-table-spacer w-1 p-0'

const checkboxColStyle: CSSProperties = {
  width: LIST_TABLE_CHECKBOX_COL_PX,
  minWidth: LIST_TABLE_CHECKBOX_COL_PX,
  maxWidth: LIST_TABLE_CHECKBOX_COL_PX,
}

const indexColStyle: CSSProperties = {
  width: LIST_TABLE_INDEX_COL_PX,
  minWidth: LIST_TABLE_INDEX_COL_PX,
  maxWidth: LIST_TABLE_INDEX_COL_PX,
}

const dragColStyle: CSSProperties = {
  width: LIST_TABLE_DRAG_COL_PX,
  minWidth: LIST_TABLE_DRAG_COL_PX,
  maxWidth: LIST_TABLE_DRAG_COL_PX,
}

const spacerColStyle: CSSProperties = {
  width: LIST_TABLE_SPACER_COL_PX,
  minWidth: LIST_TABLE_SPACER_COL_PX,
  maxWidth: LIST_TABLE_SPACER_COL_PX,
}

const expandColStyle: CSSProperties = {
  width: LIST_TABLE_EXPAND_COL_PX,
  minWidth: LIST_TABLE_EXPAND_COL_PX,
  maxWidth: LIST_TABLE_EXPAND_COL_PX,
}

const leadingInnerCls = 'flex items-center justify-center'
const checkboxLeadingInnerStyle: CSSProperties = {
  width: LIST_TABLE_CHECKBOX_COL_PX,
  height: LIST_TABLE_LEADING_ROW_PX,
}

const leadingInnerStyle: CSSProperties = {
  width: LIST_TABLE_INDEX_COL_PX,
  height: LIST_TABLE_LEADING_ROW_PX,
}

function LeadingCellWrap({ children, style }: { children?: ReactNode; style: CSSProperties }) {
  return (
    <div className={leadingInnerCls} style={style}>
      {children}
    </div>
  )
}

export type ListTableLeadingMode = 'index-only' | 'bulk' | 'bulk-index-first' | 'bulk-checkbox-only'

export function ListTableDragCol() {
  return <col className="list-page-table-drag-col" style={dragColStyle} width={LIST_TABLE_DRAG_COL_PX} />
}

export function ListTableLeadingCols({ mode = 'index-only' }: { mode?: ListTableLeadingMode }) {
  if (mode === 'bulk-checkbox-only') {
    return (
      <col
        className={listPageTableCheckboxColCls}
        style={checkboxColStyle}
        width={LIST_TABLE_CHECKBOX_COL_PX}
      />
    )
  }
  if (mode === 'bulk') {
    return (
      <>
        <col
          className={listPageTableCheckboxColCls}
          style={checkboxColStyle}
          width={LIST_TABLE_CHECKBOX_COL_PX}
        />
        <col
          className={listPageTableIndexColCls}
          style={indexColStyle}
          width={LIST_TABLE_INDEX_COL_PX}
        />
      </>
    )
  }
  if (mode === 'bulk-index-first') {
    return (
      <>
        <col
          className={listPageTableIndexColCls}
          style={indexColStyle}
          width={LIST_TABLE_INDEX_COL_PX}
        />
        <col
          className={listPageTableCheckboxColCls}
          style={checkboxColStyle}
          width={LIST_TABLE_CHECKBOX_COL_PX}
        />
      </>
    )
  }
  return (
    <col
      className={listPageTableIndexColCls}
      style={indexColStyle}
      width={LIST_TABLE_INDEX_COL_PX}
    />
  )
}

export function ListTableLeadingColgroup({ mode = 'index-only' }: { mode?: ListTableLeadingMode }) {
  return (
    <colgroup>
      <ListTableLeadingCols mode={mode} />
    </colgroup>
  )
}

export function ListTableSpacerCol() {
  return <col className="list-page-table-spacer" style={spacerColStyle} />
}

export const listPageTableExpandColCls = 'list-page-table-expand-col'
export const listPageTableExpandThCls =
  'list-page-table-expand-col box-border shrink-0 p-0 align-middle text-center'
export const listPageTableExpandTdCls =
  'list-page-table-expand-col box-border shrink-0 p-0 align-middle text-center'

export function ListTableExpandCol() {
  return (
    <col
      className={listPageTableExpandColCls}
      style={expandColStyle}
      width={LIST_TABLE_EXPAND_COL_PX}
    />
  )
}

export function ListTableExpandHeader() {
  return <th className={listPageTableExpandThCls} style={expandColStyle} aria-hidden />
}

export function ListTableExpandCell({ children }: { children?: ReactNode }) {
  return (
    <td className={listPageTableExpandTdCls} style={expandColStyle}>
      {children ? (
        <div className="flex h-full items-center justify-center">{children}</div>
      ) : null}
    </td>
  )
}

export function ListTableIndexReserveCell() {
  return (
    <td className={listPageTableIndexTdCls} style={indexColStyle} aria-hidden>
      <LeadingCellWrap style={leadingInnerStyle} />
    </td>
  )
}

export function ListTableDragHeader() {
  return (
    <th className="list-page-table-drag-col box-border p-0 align-middle" style={dragColStyle} aria-label="Reordenar" />
  )
}

export function ListTableDragCell({ children }: { children: ReactNode }) {
  return (
    <td className="list-page-table-drag-col box-border p-0 align-middle" style={dragColStyle}>
      <LeadingCellWrap style={{ width: LIST_TABLE_DRAG_COL_PX, height: LIST_TABLE_LEADING_ROW_PX }}>
        {children}
      </LeadingCellWrap>
    </td>
  )
}

export function ListTableSpacerHeader() {
  return <th className={listPageTableSpacerThCls} aria-hidden />
}

export function ListTableSpacerCell() {
  return <td className={listPageTableSpacerTdCls} aria-hidden />
}

export function ListTableIndexHeader() {
  return (
    <th className={listPageTableIndexThCls} style={indexColStyle}>
      <LeadingCellWrap style={leadingInnerStyle}>#</LeadingCellWrap>
    </th>
  )
}

export function ListTableIndexCell({ index }: { index: number | string }) {
  return (
    <td className={listPageTableIndexTdCls} style={indexColStyle}>
      <LeadingCellWrap style={leadingInnerStyle}>{index}</LeadingCellWrap>
    </td>
  )
}

export function ListTableCheckboxHeader({
  state,
  onToggle,
  reserveOnly = false,
}: {
  state?: HeaderCheckState
  onToggle?: () => void
  reserveOnly?: boolean
}) {
  const canWrite = usePageWriteAllowed()
  const hideCheckbox = reserveOnly || !canWrite
  return (
    <th className={listPageTableCheckboxThCls} style={checkboxColStyle}>
      {hideCheckbox ? (
        <LeadingCellWrap style={checkboxLeadingInnerStyle} aria-hidden />
      ) : (
        <LeadingCellWrap style={checkboxLeadingInnerStyle}>
          <BulkSelectCheckbox state={state!} onClick={onToggle!} />
        </LeadingCellWrap>
      )}
    </th>
  )
}

export function ListTableCheckboxCell({
  checked,
  state,
  onToggle,
  stopPropagation = true,
  reserveOnly = false,
  disabled = false,
  title,
}: {
  checked?: boolean
  state?: HeaderCheckState
  onToggle?: () => void
  stopPropagation?: boolean
  reserveOnly?: boolean
  disabled?: boolean
  title?: string
}) {
  const canWrite = usePageWriteAllowed()
  const hideCheckbox = reserveOnly || !canWrite
  return (
    <td
      className={listPageTableCheckboxTdCls}
      style={checkboxColStyle}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {hideCheckbox ? (
        <LeadingCellWrap style={checkboxLeadingInnerStyle} aria-hidden />
      ) : (
        <LeadingCellWrap style={checkboxLeadingInnerStyle}>
          <BulkSelectCheckbox
            state={state}
            checked={checked}
            onClick={onToggle!}
            disabled={disabled}
            title={title}
          />
        </LeadingCellWrap>
      )}
    </td>
  )
}

export function ListTableLeadingHeaders() {
  return <ListTableIndexHeader />
}

export function ListTableLeadingCells({ index }: { index: number | string }) {
  return <ListTableIndexCell index={index} />
}

export function ListTableStaticHeader({
  label,
  className = '',
}: {
  label: string
  className?: string
}) {
  return (
    <th
      className={`px-4 py-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 ${className}`.trim()}
    >
      {label}
    </th>
  )
}

export type ListTableSortDirection = 'asc' | 'desc'

export function ListTableSortableHeader({
  label,
  className = '',
  align = 'left',
  active,
  direction,
  onToggle,
  title,
}: {
  label: string
  className?: string
  align?: 'left' | 'center' | 'right'
  active: boolean
  direction: ListTableSortDirection
  onToggle: () => void
  title?: string
}) {
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const flexCls =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <th
      scope="col"
      title={title ?? label}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`cursor-pointer select-none px-4 py-3 align-middle text-[11px] font-semibold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-200/80 dark:text-gray-300 dark:hover:bg-gray-700/50 ${alignCls} ${className}`.trim()}
      onClick={onToggle}
    >
      <span className={`inline-flex items-center gap-1 ${flexCls}`}>
        {label}
        {active ? (
          direction === 'asc' ? (
            <ArrowUp size={14} className="shrink-0 text-[var(--color-1)]" aria-hidden />
          ) : (
            <ArrowDown size={14} className="shrink-0 text-[var(--color-1)]" aria-hidden />
          )
        ) : (
          <ArrowUpDown size={14} className="shrink-0 text-gray-400 opacity-60" aria-hidden />
        )}
      </span>
    </th>
  )
}
