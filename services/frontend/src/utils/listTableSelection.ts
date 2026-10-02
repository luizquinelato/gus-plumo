import type { HeaderCheckState } from '../components/BulkSelectCheckbox'

export function selectionHeaderState(ids: number[], selected: Set<number>): HeaderCheckState {
  if (ids.length === 0) return 'none'
  let count = 0
  for (const id of ids) {
    if (selected.has(id)) count += 1
  }
  if (count === 0) return 'none'
  if (count === ids.length) return 'all'
  return 'partial'
}
