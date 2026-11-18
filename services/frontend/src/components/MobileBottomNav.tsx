import { FileText, CreditCard, Home, Activity, Menu } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useSidebar } from '../contexts/SidebarContext'

const items = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/relatorios/extrato', icon: FileText, label: 'Extrato' },
  { to: '/relatorios/faturas', icon: CreditCard, label: 'Faturas' },
  { to: '/relatorios/saude', icon: Activity, label: 'Saúde' },
] as const

export default function MobileBottomNav() {
  const location = useLocation()
  const { openMobileMenu } = useSidebar()

  const linkCls = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
      active ? 'text-[var(--color-1)]' : 'text-gray-500 dark:text-gray-400'
    }`

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 md:hidden"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {items.map(({ to, icon: Icon, label }) => {
        const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
        return (
          <Link key={to} to={to} className={linkCls(active)}>
            <Icon size={20} />
            {label}
          </Link>
        )
      })}
      <button type="button" onClick={openMobileMenu} className={linkCls(false)} aria-label="Menu">
        <Menu size={20} />
        Menu
      </button>
    </nav>
  )
}