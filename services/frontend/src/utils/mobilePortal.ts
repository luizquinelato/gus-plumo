/** Rotas permitidas no modo mobile (read-only v1). */

const MOBILE_EXACT = new Set(['/', '/select-account', '/login'])
const MOBILE_PREFIXES = ['/relatorios', '/profile']

export function isPathAllowedOnMobile(pathname: string): boolean {
  if (MOBILE_EXACT.has(pathname)) return true
  return MOBILE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export const MOBILE_DEFAULT_ROUTE = '/relatorios/extrato'