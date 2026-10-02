import { Children, isValidElement, type ReactNode } from 'react'
import {
  listPageTableBodyCls,
  listPageTableCls,
  listPageTableChromeHeaderCls,
  listPageTableSectionCls,
} from './CadastroListPageLayout'
import {
  ListTableDragCol,
  ListTableLeadingCols,
  ListTableSpacerCol,
  type ListTableLeadingMode,
} from './ListTableSelectColumns'

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
  alignWithListLeading = false,
}: {
  head: ReactNode
  children?: ReactNode
  empty?: ReactNode
  /** Checkbox 40px + `#` 40px + spacer 4px — igual à {@link ListPageTable} principal. */
  alignWithListLeading?: boolean
}) {
  const tableCls = alignWithListLeading ? `${listPageTableCls} table-fixed` : 'w-full text-sm'
  const headCls = alignWithListLeading
    ? `${listPageTableChromeHeaderCls} [&_th]:py-2`
    : 'bg-gray-50 dark:bg-gray-800/80'
  const bodyCls = alignWithListLeading
    ? `${listPageTableBodyCls} [&_td]:py-2`
    : 'divide-y divide-gray-100 dark:divide-gray-700'

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <table className={tableCls} data-leading={alignWithListLeading ? 'bulk' : undefined}>
        {alignWithListLeading ? (
          <colgroup>
            <ListTableLeadingCols mode="bulk" />
            <ListTableSpacerCol />
          </colgroup>
        ) : null}
        <thead className={headCls}>{head}</thead>
        <tbody className={bodyCls}>{empty ?? children}</tbody>
      </table>
    </div>
  )
}

/** Extrai `<col>` de fragmento ou `<colgroup>`. */
function flattenColElements(node: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'colgroup') {
      Children.forEach((child.props as { children?: ReactNode }).children, (c) => {
        if (isValidElement(c) && c.type === 'col') out.push(c)
      })
      return
    }
    if (child.type === 'col') out.push(child)
  })
  return out
}

/** Shell padrão de listagem — colunas líderes (checkbox / `#`) isoladas em {@link ListTableLeadingColgroup}. */
export function ListPageTable({
  minWidth,
  leadingMode = 'index-only',
  colgroupRest,
  colsRest,
  head,
  children,
  headCls = listPageTableChromeHeaderCls,
  bodyCls = listPageTableBodyCls,
  footer,
  framed = true,
  fixedLayout = true,
  tableClassName,
  leadingPrefixCol = false,
}: {
  minWidth?: number
  leadingMode?: ListTableLeadingMode
  /** @deprecated Use `colsRest`. */
  colgroupRest?: ReactNode
  /** Colunas após checkbox/#/spacer — apenas `<col>`. */
  colsRest?: ReactNode
  head: ReactNode
  children: ReactNode
  headCls?: string
  bodyCls?: string
  footer?: ReactNode
  framed?: boolean
  fixedLayout?: boolean
  tableClassName?: string
  /** Coluna estreita à esquerda do checkbox/# (ex.: handle de drag). */
  leadingPrefixCol?: boolean
}) {
  const legacyCols = flattenColElements(colgroupRest)
  const tableCls = fixedLayout ? `${listPageTableCls} table-fixed` : listPageTableCls

  const table = (
    <>
      <div className={minWidth ? 'overflow-x-auto' : 'overflow-x-hidden'}>
        <table
          className={`${tableCls}${tableClassName ? ` ${tableClassName}` : ''}`}
          data-leading={leadingMode}
          style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
        >
          <colgroup>
            {leadingPrefixCol ? <ListTableDragCol /> : null}
            <ListTableLeadingCols mode={leadingMode} />
            {colsRest}
            {legacyCols}
          </colgroup>
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
