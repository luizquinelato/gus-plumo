import { Menu } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useSidebar } from '../contexts/SidebarContext'

const titles: Record<string, string> = {
  '/': 'Home',
  '/relatorios/extrato': 'Extrato',
  '/relatorios/faturas': 'Faturas',
  '/relatorios/grupo': 'Grupo',
  '/relatorios/projecao-mensal': 'Projeção',
  '/relatorios/saldo-parcelado': 'Saldo parcelado',
  '/relatorios/saude': 'Saúde financeira',
}

function resolveTitle(pathname: string): string {
  if (titles[pathname]) return titles[pathname]
  if (pathname.startsWith('/relatorios')) return 'Relatórios'
  return 'Plumo'
}

export default function MobileTopBar() {
  const location = useLocation()
  const { openMobileMenu } = useSidebar()
  const title = resolveTitle(location.pathname)

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 flex h-12 items-center gap-3 border-b border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900 md:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <button
        type="button"
        onClick={openMobileMenu}
        className="rounded-lg p-2 text-gray-700 dark:text-gray-200"
        aria-label="Abrir menu"
      >
        <Menu size={22} />
      </button>
      <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
      <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-gray-400">Somente leitura</span>
    </header>
  )
}