import type { CSSProperties, ReactNode } from 'react'

export const LIST_TABLE_INDEX_COL_PX = 40
export const LIST_TABLE_LEADING_ROW_PX = 48
export const LIST_TABLE_SPACER_COL_PX = 4

export const listPageTableIndexColCls = 'list-page-table-index-col'
export const listPageTableIndexThCls =
  'list-page-table-index-col box-border shrink-0 p-0 align-middle text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'
export const listPageTableIndexTdCls =
  'list-page-table-index-col box-border shrink-0 p-0 align-middle text-center font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500'
export const listPageTableSpacerThCls = 'list-page-table-spacer w-1 p-0'
export const listPageTableSpacerTdCls = 'list-page-table-spacer w-1 p-0'

const indexColStyle: CSSProperties = {
  width: LIST_TABLE_INDEX_COL_PX,
  minWidth: LIST_TABLE_INDEX_COL_PX,
  maxWidth: LIST_TABLE_INDEX_COL_PX,
}

const spacerColStyle: CSSProperties = {
  width: LIST_TABLE_SPACER_COL_PX,
  minWidth: LIST_TABLE_SPACER_COL_PX,
  maxWidth: LIST_TABLE_SPACER_COL_PX,
}

const leadingInnerCls = 'flex items-center justify-center'
const leadingInnerStyle: CSSProperties = {
  width: LIST_TABLE_INDEX_COL_PX,
  height: LIST_TABLE_LEADING_ROW_PX,
}

function LeadingCellWrap({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <div className={leadingInnerCls} style={style}>
      {children}
    </div>
  )
}

export type ListTableLeadingMode = 'index-only'

export function ListTableLeadingCols() {
  return (
    <col
      className={listPageTableIndexColCls}
      style={indexColStyle}
      width={LIST_TABLE_INDEX_COL_PX}
    />
  )
}

export function ListTableLeadingColgroup() {
  return (
    <colgroup>
      <ListTableLeadingCols />
    </colgroup>
  )
}

export function ListTableSpacerCol() {
  return <col className="list-page-table-spacer" style={spacerColStyle} />
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
      className={`px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 ${className}`.trim()}
    >
      {label}
    </th>
  )
}
