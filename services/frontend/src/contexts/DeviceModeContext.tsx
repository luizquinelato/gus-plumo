import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const MOBILE_MEDIA = '(max-width: 767px)'

export type DeviceMode = 'portal' | 'mobile'

interface DeviceModeContextValue {
  mode: DeviceMode
  isMobile: boolean
  isPortal: boolean
  isReadOnlyMobile: boolean
}

const DeviceModeContext = createContext<DeviceModeContextValue | undefined>(undefined)

export function DeviceModeProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MEDIA).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const value = useMemo<DeviceModeContextValue>(
    () => ({
      mode: isMobile ? 'mobile' : 'portal',
      isMobile,
      isPortal: !isMobile,
      isReadOnlyMobile: isMobile,
    }),
    [isMobile],
  )

  return <DeviceModeContext.Provider value={value}>{children}</DeviceModeContext.Provider>
}

export function useDeviceMode() {
  const ctx = useContext(DeviceModeContext)
  if (!ctx) {
    throw new Error('useDeviceMode must be used within DeviceModeProvider')
  }
  return ctx
}