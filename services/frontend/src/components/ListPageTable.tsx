import type { ReactNode } from 'react'
import {
  listPageTableBodyCls,
  listPageTableCls,
  listPageTableChromeHeaderCls,
  listPageTableSectionCls,
} from './CadastroListPageLayout'
import { ListTableLeadingColgroup } from './ListTableSelectColumns'

export function ListPageExpandRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-gray-200 p-0 dark:border-gray-700">
        <div className="relative">
          <div className="absolute left-6 right-6 top-0 h-px border-t border-dashed border-[color-mix(in_srgb,var(--color-1)_40%,transparent)]" />
          <div className="bg-slate-100 px-5 py-4 dark:bg-gray-900/60">{children}</div>
        </div>
      </td>
    </tr>
  )
}

export function ListPageNestedTable({
  head,
  children,
  empty,
}: {
  head: ReactNode
  children?: ReactNode
  empty?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/80">{head}</thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{empty ?? children}</tbody>
      </table>
    </div>
  )
}

export function ListPageTable({
  minWidth,
  colsRest,
  head,
  children,
  headCls = listPageTableChromeHeaderCls,
  bodyCls = listPageTableBodyCls,
  footer,
  framed = true,
}: {
  minWidth?: number
  colsRest?: ReactNode
  head: ReactNode
  children: ReactNode
  headCls?: string
  bodyCls?: string
  footer?: ReactNode
  framed?: boolean
}) {
  const table = (
    <>
      <div className={minWidth ? 'overflow-x-auto' : 'overflow-x-hidden'}>
        <table
          className={`${listPageTableCls} table-fixed`}
          style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
        >
          <ListTableLeadingColgroup />
          {colsRest ? <colgroup>{colsRest}</colgroup> : null}
          <thead className={headCls}>{head}</thead>
          <tbody className={bodyCls}>{children}</tbody>
        </table>
      </div>
      {footer}
    </>
  )
  if (!framed) return table
  return <section className={listPageTableSectionCls}>{table}</section>
}
