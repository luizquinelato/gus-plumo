import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LucideIcon } from 'lucide-react'

export interface SidebarNavSubItem {
  icon: LucideIcon
  label: string
  path: string
}

interface SidebarNavGroupProps {
  id: string
  icon: LucideIcon
  label: string
  routes: string[]
  items: SidebarNavSubItem[]
  collapsed: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
}

const SidebarNavGroup = ({
  icon: Icon,
  label,
  routes,
  items,
  collapsed,
  open,
  onToggle,
  onClose,
}: SidebarNavGroupProps) => {
  const location = useLocation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  const isActive = routes.some(
    (route) => location.pathname === route || location.pathname.startsWith(`${route}/`),
  )

  useEffect(() => {
    if (!open || !collapsed) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        buttonRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return
      }
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, collapsed, onClose])

  const rowClass = collapsed
    ? 'justify-center px-0 py-2.5'
    : 'px-3 py-2'

  return (
    <li className="relative">
      <div className="relative">
        {!collapsed && isActive && (
          <span
            aria-hidden
            className="absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full pointer-events-none"
            style={{ background: 'var(--color-1)' }}
          />
        )}
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title={collapsed ? label : undefined}
          className={`
            w-full flex items-center gap-3 rounded-lg transition-colors duration-200
            ${rowClass}
            ${isActive ? '' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
          `}
          style={
            isActive && !open
              ? { color: 'var(--color-1)' }
              : open
                ? { background: 'rgba(255,255,255,0.06)', color: isActive ? 'var(--color-1)' : undefined }
                : undefined
          }
        >
          <Icon size={20} />
          {!collapsed && <span className="font-medium flex-1 text-left text-sm">{label}</span>}
          {!collapsed && (
            <ChevronRight
              size={15}
              className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            />
          )}
        </button>
        {collapsed && isActive && !open && (
          <span
            aria-hidden
            className="absolute -left-1 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full pointer-events-none"
            style={{ background: 'var(--color-1)' }}
          />
        )}
        {collapsed && hovered && !open && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded bg-gray-950 text-white text-xs font-semibold whitespace-nowrap pointer-events-none z-[9999]">
            {label}
          </div>
        )}
      </div>

      {collapsed && open && buttonRef.current &&
        createPortal(
          (() => {
            const rect = buttonRef.current!.getBoundingClientRect()
            const anchorBottom = rect.bottom > window.innerHeight * 0.55
            return (
          <div
            ref={popupRef}
            className="fixed flex w-56 max-h-[min(70vh,calc(100vh-1rem))] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
            style={{
              left: rect.right + 8,
              ...(anchorBottom
                ? { bottom: window.innerHeight - rect.bottom }
                : { top: Math.max(8, Math.min(rect.top, window.innerHeight - 120)) }),
              zIndex: 99999,
            }}
          >
            <div className="shrink-0 border-b border-gray-700 px-4 pb-2 pt-3">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-1)' }}>
                {label}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
              {items.map((subItem) => {
                const SubIcon = subItem.icon
                const isSubActive =
                  location.pathname === subItem.path || location.pathname.startsWith(`${subItem.path}/`)
                return (
                  <Link
                    key={subItem.path}
                    to={subItem.path}
                    onClick={onClose}
                    className={`
                      flex items-center gap-3 px-4 py-2 mx-1.5 rounded-lg
                      transition-colors duration-200 text-sm
                      ${isSubActive ? '' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}
                    `}
                    style={
                      isSubActive
                        ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' }
                        : undefined
                    }
                  >
                    <SubIcon size={17} />
                    <span className="font-medium">{subItem.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
            )
          })(),
          document.body,
        )}

      {!collapsed && open && (
        <div
          className="mt-0.5 mb-1.5 ml-2 pl-2.5 pr-1 py-1.5 rounded-lg border border-gray-700/80 bg-gray-800/50"
          style={{ borderLeft: '2px solid color-mix(in srgb, var(--color-1) 45%, transparent)' }}
        >
          <div className="space-y-0.5">
            {items.map((subItem) => {
              const SubIcon = subItem.icon
              const isSubActive =
                location.pathname === subItem.path || location.pathname.startsWith(`${subItem.path}/`)
              return (
                <Link
                  key={subItem.path}
                  to={subItem.path}
                  className={`
                    flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors duration-200
                    ${isSubActive ? '' : 'text-gray-300 hover:bg-gray-700/80 hover:text-white'}
                  `}
                  style={
                    isSubActive
                      ? { background: 'var(--gradient-1-2)', color: 'var(--on-gradient-1-2)' }
                      : undefined
                  }
                >
                  <SubIcon size={16} />
                  <span className="font-medium truncate">{subItem.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </li>
  )
}

export default SidebarNavGroup
