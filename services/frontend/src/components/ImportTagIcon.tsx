import { useEffect, useState } from 'react'
import axios from 'axios'
import IconPicker from './IconPicker'
import { findIconComponent, getIconComponent } from '../utils/iconMapper'
import type { CadastroImportPreviewRow } from './CadastroImportPreview'

export type IconChoices = {
  overrides: Record<string, string>
  onChange?: (row: CadastroImportPreviewRow, icon: string) => void
  availableIcons: string[]
  iconNamesPt: Record<string, string>
  ready: boolean
}

export function isTagEntity(entity: string | null | undefined): boolean {
  return entity === 'tag' || entity === 'subtag'
}

function iconOverrideKey(entity: string | null | undefined, row: number): string {
  return `${entity ?? ''}:${row}`
}

function resolveCatalogIcon(
  raw: string,
  availableIcons: string[],
  iconNamesPt: Record<string, string>,
): string | null {
  const text = raw.trim()
  if (!text || text === '—') return null
  const folded = text.toLowerCase()
  return (
    availableIcons.find((name) => name === text) ||
    availableIcons.find((name) => name.toLowerCase() === folded) ||
    availableIcons.find((name) => (iconNamesPt[name] || '').toLowerCase() === folded) ||
    (findIconComponent(text) ? text : null)
  )
}

export function useIconCatalog(enabled: boolean) {
  const [availableIcons, setAvailableIcons] = useState<string[]>([])
  const [iconNamesPt, setIconNamesPt] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancel = false
    Promise.all([
      axios.get<string[]>('/api/expenses/available-icons'),
      axios.get<Record<string, string>>('/api/expenses/icon-names-pt'),
    ])
      .then(([icons, names]) => {
        if (cancel) return
        setAvailableIcons(Array.isArray(icons.data) ? icons.data : [])
        setIconNamesPt(names.data && typeof names.data === 'object' ? names.data : {})
        setReady(true)
      })
      .catch(() => {
        if (!cancel) setReady(true)
      })
    return () => {
      cancel = true
    }
  }, [enabled])

  return { availableIcons, iconNamesPt, ready }
}

export function TagIconCell({
  raw,
  row,
  overrides,
  onChange,
  availableIcons,
  iconNamesPt,
  ready,
  editable,
  size = 16,
}: IconChoices & {
  raw: string
  row: CadastroImportPreviewRow
  editable: boolean
  size?: number
}) {
  const shown = (editable ? overrides[iconOverrideKey(row.entity, row.row)] : undefined) ?? raw
  const resolved = ready ? resolveCatalogIcon(shown, availableIcons, iconNamesPt) : findIconComponent(shown) ? shown : null

  useEffect(() => {
    if (!editable || !onChange || !resolved || resolved === shown) return
    onChange(row, resolved)
  }, [editable, onChange, resolved, shown, row])

  if (!shown || shown === '—') return <>—</>
  if (resolved) {
    const Icon = getIconComponent(resolved)
    return (
      <span title={iconNamesPt[resolved] || resolved} className="inline-flex">
        <Icon size={size} aria-label={iconNamesPt[resolved] || resolved} />
      </span>
    )
  }
  if (!ready || !editable || !onChange) return <>{shown}</>
  return (
    <IconPicker
      compact
      value={shown}
      availableIcons={availableIcons}
      iconNamesPt={iconNamesPt}
      onChange={(icon) => onChange(row, icon)}
    />
  )
}
