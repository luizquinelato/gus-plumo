import type { ReactNode } from 'react'
import { useDeviceMode } from '../contexts/DeviceModeContext'

/** Oculta ações de escrita no modo mobile (portal-only). */
export default function PortalOnly({ children }: { children: ReactNode }) {
  const { isMobile } = useDeviceMode()
  if (isMobile) return null
  return <>{children}</>
}