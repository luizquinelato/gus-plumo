import { ReactNode } from 'react'
import { useSidebar } from '../contexts/SidebarContext'

interface FloatingFooterBarProps {
  children: ReactNode
  className?: string
}

const FloatingFooterBar = ({ children, className = '' }: FloatingFooterBarProps) => {
  const { sidebarLeftClass } = useSidebar()

  return (
    <div
      className={`fixed bottom-0 ${sidebarLeftClass} right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3 transition-[left] duration-300 ease-in-out ${className}`}
    >
      {children}
    </div>
  )
}

export default FloatingFooterBar
