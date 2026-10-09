import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Menu, FileSpreadsheet, Loader2 } from 'lucide-react'

export type CadastroExcelMenuExtraItem = {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}

export interface CadastroExcelMenuProps {
  disabled?: boolean
  exportDisabled?: boolean
  onExportExcel?: () => void
  extraItems?: CadastroExcelMenuExtraItem[]
  menuTitle?: string
}

export default function CadastroExcelMenu({
  disabled = false,
  exportDisabled = false,
  onExportExcel,
  extraItems = [],
  menuTitle = 'Exportar',
}: CadastroExcelMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const itemCls =
    'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-700'

  const closeAnd = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        title={menuTitle}
        aria-label={menuTitle}
      >
        <Menu size={20} />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 min-w-[220px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {onExportExcel ? (
            <button
              type="button"
              className={itemCls}
              disabled={exportDisabled}
              onClick={() => closeAnd(onExportExcel)}
            >
              <FileSpreadsheet size={16} />
              Exportar Excel
            </button>
          ) : null}
          {extraItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={itemCls}
              disabled={item.disabled}
              onClick={() => closeAnd(item.onClick)}
            >
              {item.loading ? <Loader2 size={16} className="animate-spin" /> : item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Botões primários à esquerda e menu Excel à direita (padrão cadastro). */
export function CadastroListHeaderActions({
  children,
  menu,
}: {
  children: ReactNode
  menu?: CadastroExcelMenuProps
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {menu ? <CadastroExcelMenu {...menu} /> : null}
    </div>
  )
}
