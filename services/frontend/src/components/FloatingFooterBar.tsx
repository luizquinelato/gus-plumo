import { ReactNode } from 'react'
import { useSidebar } from '../contexts/SidebarContext'

interface FloatingFooterBarProps {
  children: ReactNode
  className?: string
}

const FloatingFooterBar = ({ children, className = '' }: FloatingFooterBarProps) => {
  const { sidebarLeftClass } = useSidebar()

  const leftCls = sidebarLeftClass === 'left-16' ? 'md:left-16' : 'md:left-64'

  return (
    <div
      className={`fixed bottom-0 right-0 z-50 hidden border-t-2 border-color-primary bg-white px-6 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] transition-[left] duration-300 ease-in-out dark:bg-gray-800 md:block ${leftCls} ${className}`}
    >
      {children}
    </div>
  )
}

export default FloatingFooterBar
