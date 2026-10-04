/** Cores distintas por conta (tema --color-1 … --color-5), estáveis na lista de fechamentos. */
export const SHARED_ACCOUNT_NAME_COLOR_CLASSES = [
  'font-semibold text-color-1',
  'font-semibold text-color-2',
  'font-semibold text-color-3',
  'font-semibold text-color-4',
  'font-semibold text-color-5',
] as const

export function buildSharedAccountNameColorMap(
  accountIds: Iterable<number>,
  excludeAccountId?: number | null,
): Map<number, string> {
  const exclude = excludeAccountId != null ? Number(excludeAccountId) : null
  const unique = [
    ...new Set(
      [...accountIds].filter((id) => Number.isFinite(id) && id > 0 && (exclude == null || id !== exclude)),
    ),
  ].sort((a, b) => a - b)
  const map = new Map<number, string>()
  unique.forEach((id, index) => {
    map.set(id, SHARED_ACCOUNT_NAME_COLOR_CLASSES[index % SHARED_ACCOUNT_NAME_COLOR_CLASSES.length])
  })
  return map
}

export function sharedAccountNameColorClass(
  colorByAccountId: Map<number, string>,
  accountId: number | null | undefined,
  loggedAccountId?: number | null,
): string {
  if (accountId == null) return ''
  if (loggedAccountId != null && Number(accountId) === Number(loggedAccountId)) return ''
  return colorByAccountId.get(Number(accountId)) ?? 'font-semibold text-gray-700 dark:text-gray-200'
}
