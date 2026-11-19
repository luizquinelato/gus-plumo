import { AlertTriangle } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
} from '../components/CadastroFormLayout'
import { ProjectionOriginBadges } from '../components/ProjectionOriginBadge'
import { formatCurrency } from '../utils/currency'

export type LaunchIncomeReplacePreviewRow = {
  year_month: string
  payroll_kind: 'advance' | 'final'
  label: string
  existing_amount?: string | number | null
  existing_date?: string | null
  existing_source?: string | null
  existing_linked_extrato?: boolean
  proposed_amount?: string | number | null
  proposed_date?: string | null
  proposed_source?: string | null
  amount_diverges: boolean
  date_diverges: boolean
  source_diverges: boolean
  will_remove_without_replacement: boolean
}

export type LaunchIncomeReplaceSlotSelection = {
  year_month: string
  payroll_kind: 'advance' | 'final'
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const emphasis = 'font-semibold text-gray-900 dark:text-white'
const moneyCls = 'font-semibold tabular-nums text-green-600 dark:text-green-400'
const muted = 'text-gray-600 dark:text-gray-400'
const cardCls =
  'rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-800/60'

const slotKey = (row: LaunchIncomeReplacePreviewRow) => `${row.year_month}:${row.payroll_kind}`

const formatYearMonthLabel = (ym: string) =>
  `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

const payrollProjSourceLabel = (src: string | null | undefined) =>
  src === 'payroll_estimate' ? 'Estimativa de folha' : src === 'payroll' ? 'Holerite' : '—'

const payrollOriginBadges = (src: string | null | undefined, linkedExtrato?: boolean) => {
  if (src === 'payroll_estimate') return <ProjectionOriginBadges source="payroll_estimate" />
  if (src === 'payroll') return <ProjectionOriginBadges source="payroll" linkedExtrato={linkedExtrato} />
  return null
}

const formatProjectionIsoDay = (iso: string | null | undefined) =>
  iso ? iso.split('-').reverse().join('/') : '—'

export function useLaunchIncomeReplaceChoice() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LaunchIncomeReplacePreviewRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const resolveRef = useRef<((value: LaunchIncomeReplaceSlotSelection[] | null) => void) | null>(null)

  const close = useCallback((result: LaunchIncomeReplaceSlotSelection[] | null) => {
    setOpen(false)
    setItems([])
    setSelected(new Set())
    resolveRef.current?.(result)
    resolveRef.current = null
  }, [])

  const ask = useCallback(
    (rows: LaunchIncomeReplacePreviewRow[]): Promise<LaunchIncomeReplaceSlotSelection[] | null> => {
      setItems(rows)
      setSelected(new Set(rows.map(slotKey)))
      setOpen(true)
      return new Promise((resolve) => {
        resolveRef.current = resolve
      })
    },
    [],
  )

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const byMonth = new Map<string, LaunchIncomeReplacePreviewRow[]>()
  for (const row of items) {
    const list = byMonth.get(row.year_month) ?? []
    list.push(row)
    byMonth.set(row.year_month, list)
  }

  const body: ReactNode = items.length > 0 ? (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        Já há receitas automáticas de folha. Marque quais deseja{' '}
        <span className={emphasis}>substituir</span>; as demais permanecem como estão.
      </p>
      {[...byMonth.entries()].map(([ym, rows]) => (
        <div key={ym}>
          <p className={`text-sm ${emphasis}`}>{formatYearMonthLabel(ym)}</p>
          <ul className="mt-1.5 space-y-1.5">
            {rows.map((row) => {
              const key = slotKey(row)
              const checked = selected.has(key)
              return (
                <li key={key}>
                  <label
                    className={`block cursor-pointer rounded-md border px-2.5 py-2 transition-colors ${
                      checked
                        ? 'border-[var(--color-1)] bg-[var(--color-1)]/10 dark:bg-[var(--color-1)]/15'
                        : 'border-gray-200 hover:border-[var(--color-1)] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(key)}
                        className={`h-4 w-4 shrink-0 rounded ${cadastroAccentControlCls}`}
                      />
                      <span className={`text-sm ${emphasis}`}>{row.label}</span>
                    </span>
                    <span className="mt-1 block min-w-0 pl-[26px]">
                      <span className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${muted}`}>
                        <span>
                          Atual:{' '}
                          <span className={moneyCls}>{formatCurrency(Number(row.existing_amount ?? 0))}</span>
                          {row.existing_source !== 'payroll_estimate' && row.existing_source !== 'payroll' ? (
                            <>
                              {' · '}
                              {payrollProjSourceLabel(row.existing_source)}
                            </>
                          ) : null}
                          {' · dia '}
                          {formatProjectionIsoDay(row.existing_date ?? undefined)}
                        </span>
                        {payrollOriginBadges(row.existing_source, row.existing_linked_extrato)}
                      </span>
                      {row.will_remove_without_replacement ? (
                        <span className="mt-1 block text-xs font-medium text-amber-800 dark:text-amber-200">
                          Será removido — não há holerite/estimativa para recriar.
                        </span>
                      ) : row.proposed_amount != null ? (
                        <span className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${muted}`}>
                          <span>
                            Novo:{' '}
                            <span className={moneyCls}>{formatCurrency(Number(row.proposed_amount))}</span>
                            {' · dia '}
                            {formatProjectionIsoDay(row.proposed_date ?? undefined)}
                          </span>
                          {payrollOriginBadges(row.proposed_source)}
                        </span>
                      ) : null}
                      {!row.will_remove_without_replacement &&
                      (row.amount_diverges || row.date_diverges || row.source_diverges) ? (
                        <span className={`mt-1 block text-[11px] italic ${muted}`}>
                          Divergência em{' '}
                          {[
                            row.amount_diverges ? 'valor' : null,
                            row.date_diverges ? 'data' : null,
                            row.source_diverges ? 'origem' : null,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                          .
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  ) : null

  const DialogComponent = () =>
    !open || items.length === 0 ? null : (
      <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={() => close(null)} zClass="z-[110]">
        <CadastroModalHeader
          isEdit={false}
          title="Substituir receita da folha?"
          onClose={() => close(null)}
          icon={<AlertTriangle size={18} />}
          iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
        />
        <CadastroModalBody>{body}</CadastroModalBody>
        <CadastroModalFooter
          onClose={() => close(null)}
          closeLabel="Cancelar"
          onSave={() => {
            const out: LaunchIncomeReplaceSlotSelection[] = items
              .filter((row) => selected.has(slotKey(row)))
              .map((row) => ({ year_month: row.year_month, payroll_kind: row.payroll_kind }))
            close(out)
          }}
          saveLabel="Substituir"
          saveTone="create"
          hideSave={selected.size === 0}
        />
      </CadastroModalShell>
    )

  return { ask, DialogComponent, isOpen: open }
}