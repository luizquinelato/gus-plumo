import { useLocation } from 'react-router-dom'

const titles: Record<string, string> = {
  '/': 'Plumo',
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
  const title = resolveTitle(location.pathname)

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 flex h-12 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900 md:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 dark:text-white">
        {title}
      </h1>
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400">
        Somente leitura
      </span>
    </header>
  )
}