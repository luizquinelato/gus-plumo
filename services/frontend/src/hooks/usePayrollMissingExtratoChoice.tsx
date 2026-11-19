import { AlertTriangle } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
} from '../components/CadastroFormLayout'
import { formatCurrency } from '../utils/currency'

export type PayrollExtratoCreditChoiceRow = {
  statement_id: number
  credit_date: string
  description: string
  amount: string
  my_amount: string
}

export type PayrollMissingExtratoItem = {
  description: string
  amount: string
  expected_day: number
  search_from?: string | null
  search_to?: string | null
  period_incomes?: PayrollExtratoCreditChoiceRow[]
}

export type PayrollMissingExtratoChoice = { kind: 'keep' } | { kind: 'link'; statementId: number }

const emphasis = 'font-semibold text-gray-900 dark:text-white'
const moneyCls = 'font-semibold tabular-nums text-green-600 dark:text-green-400'
const muted = 'text-gray-600 dark:text-gray-400'
const cardCls =
  'rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-800/60'

const formatIsoDateBr = (iso: string) => iso.split('-').reverse().join('/')

const displayCreditValue = (row: PayrollExtratoCreditChoiceRow) => {
  const mine = Number(row.my_amount)
  const full = Number(row.amount)
  if (!Number.isNaN(mine) && mine !== full) {
    return formatCurrency(mine)
  }
  return formatCurrency(full)
}

export function usePayrollMissingExtratoChoice() {
  const [open, setOpen] = useState(false)
  const [item, setItem] = useState<PayrollMissingExtratoItem | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const resolveRef = useRef<((value: PayrollMissingExtratoChoice | null) => void) | null>(null)

  const close = useCallback((result: PayrollMissingExtratoChoice | null) => {
    setOpen(false)
    setItem(null)
    setSelectedId(null)
    resolveRef.current?.(result)
    resolveRef.current = null
  }, [])

  const ask = useCallback((row: PayrollMissingExtratoItem): Promise<PayrollMissingExtratoChoice | null> => {
    setItem(row)
    setSelectedId(null)
    setOpen(true)
    return new Promise((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const incomes = item?.period_incomes ?? []

  const body: ReactNode = item ? (
    <div className="space-y-3">
      <p>
        Não há no extrato uma entrada com o <span className={emphasis}>mesmo valor exato</span> deste lançamento de
        folha:
      </p>
      <div className={cardCls}>
        <p className={emphasis}>{item.description}</p>
        <p className="mt-1">
          <span className={moneyCls}>{formatCurrency(Number(item.amount))}</span>
          <span className={muted}> · dia {item.expected_day}</span>
        </p>
      </div>
      {item.search_from && item.search_to ? (
        <p>
          <span className={emphasis}>Período consultado:</span> {formatIsoDateBr(item.search_from)} a{' '}
          {formatIsoDateBr(item.search_to)}
        </p>
      ) : null}
      <div>
        <p className={`mb-1.5 ${emphasis}`}>Receitas no extrato — marque uma para vincular como folha</p>
        {incomes.length > 0 ? (
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {incomes.map((row) => {
              const selected = selectedId === row.statement_id
              const meta = `${formatIsoDateBr(row.credit_date)}, ${row.description}`
              return (
                <li key={row.statement_id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${
                      selected
                        ? 'border-[var(--color-1)] bg-[var(--color-1)]/10 dark:bg-[var(--color-1)]/15'
                        : 'border-gray-200 hover:border-[var(--color-1)] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => setSelectedId(selected ? null : row.statement_id)}
                      className={`h-4 w-4 shrink-0 rounded ${cadastroAccentControlCls}`}
                    />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className={`block text-sm ${moneyCls}`}>{displayCreditValue(row)}</span>
                      <span className={`mt-0.5 block text-[11px] leading-snug ${muted}`}>({meta})</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className={muted}>Nenhum crédito encontrado nesse intervalo.</p>
        )}
      </div>
      {selectedId == null ? (
        <p className={`text-xs italic leading-snug ${muted}`}>
          <span className="font-semibold text-gray-700 dark:text-gray-300">Nota:</span> Manter Folha deixa a
          projeção sem vínculo ao extrato.
        </p>
      ) : null}
    </div>
  ) : null

  const DialogComponent = () =>
    !open || !item ? null : (
      <CadastroModalShell maxWidth="max-w-md" onBackdropClick={() => close(null)} zClass="z-[110]">
        <CadastroModalHeader
          isEdit={false}
          title="Folha não encontrada no extrato"
          onClose={() => close(null)}
          icon={<AlertTriangle size={18} />}
          iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
        />
        <CadastroModalBody>{body}</CadastroModalBody>
        <CadastroModalFooter
          onClose={() => close(null)}
          closeLabel="Cancelar"
          onSave={() =>
            close(
              selectedId != null
                ? { kind: 'link', statementId: selectedId }
                : { kind: 'keep' },
            )
          }
          saveLabel={selectedId != null ? 'Atualizar Folha' : 'Manter Folha'}
          saveTone="create"
        />
      </CadastroModalShell>
    )

  return { ask, DialogComponent, isOpen: open }
}