import { useEffect, useState } from 'react'
import axios from 'axios'
import { AlertTriangle, Ban, CheckCircle2, Link2, Loader2, Search, Unlink, X } from 'lucide-react'
import Badge from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { cadastroAccentControlCls, cadastroFieldCls, CadastroFieldLabel } from './CadastroFormLayout'
import BrazilianDatePicker from './BrazilianDatePicker'
import { dateToLocalString, parseLocalDate } from '../utils/dateUtils'
import type { InvoiceMatchCandidate, InvoiceMatchCycle } from '../types/invoiceReconcile'

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '—'
  const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  return date.toLocaleDateString('pt-BR')
}

const monthLabel = (relative?: InvoiceMatchCandidate['month_relative']) => {
  if (relative === 'previous') return 'mês anterior'
  if (relative === 'next') return 'mês seguinte'
  if (relative === 'current') return 'neste mês'
  return null
}

const formatAmountMask = (cents: string): string => {
  const num = parseInt(cents || '0', 10)
  return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const amountFromCents = (cents: string): number | null => {
  const num = parseInt(cents || '0', 10)
  if (!Number.isFinite(num) || num <= 0) return null
  return num / 100
}

const defaultWindow = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  if (!year || !month) return { start: '', end: '' }
  return {
    start: dateToLocalString(new Date(year, month - 2, 1)),
    end: dateToLocalString(new Date(year, month + 1, 0)),
  }
}

const centsOf = (value: number) => Math.round(Math.abs(value) * 100)

const applyCentsMask = (raw: string, setter: (cents: string) => void) => {
  const cents = raw.replace(/\D/g, '')
  const absValue = parseInt(cents || '0', 10) / 100
  if (absValue > 99999999.99) return
  setter(cents)
}

export function InvoiceReconcilePickPanel({
  cycle,
  busy,
  inline,
  onClose,
  onConfirm,
  onUnmatch,
  onSkip,
}: {
  cycle: InvoiceMatchCycle
  busy?: boolean
  inline?: boolean
  onClose?: () => void
  onConfirm: (bankStatementId: number) => void
  onUnmatch: () => void
  onSkip?: () => void
}) {
  const [selectedId, setSelectedId] = useState<number | undefined>()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minAmountCents, setMinAmountCents] = useState('')
  const [maxAmountCents, setMaxAmountCents] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchCandidates, setSearchCandidates] = useState<InvoiceMatchCandidate[]>([])
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const window = defaultWindow(cycle.year_month)
    setStartDate(window.start)
    setEndDate(window.end)
    const invoiceCents = String(centsOf(cycle.amount_to_pay))
    setMinAmountCents(invoiceCents)
    setMaxAmountCents(invoiceCents)
    setSearched(false)
    setSearchError(null)
    setSearchCandidates([])
    setTruncated(false)
    const autoId = cycle.auto_candidate ? Number(cycle.auto_candidate.bank_statement_id) : undefined
    if (autoId && Number.isFinite(autoId)) {
      setSelectedId(autoId)
    } else if (cycle.candidates.length === 1) {
      const onlyId = Number(cycle.candidates[0].bank_statement_id)
      setSelectedId(Number.isFinite(onlyId) ? onlyId : undefined)
    } else {
      setSelectedId(undefined)
    }
  }, [cycle.key])

  const runSearch = async () => {
    const minAmount = amountFromCents(minAmountCents)
    const maxAmount = amountFromCents(maxAmountCents)
    if (!startDate || !endDate) {
      setSearchError('Informe data de início e fim')
      return
    }
    if (endDate < startDate) {
      setSearchError('Data fim deve ser posterior à data início')
      return
    }
    if (minAmount == null || maxAmount == null) {
      setSearchError('Informe valor mínimo e máximo maiores que zero')
      return
    }
    if (maxAmount < minAmount) {
      setSearchError('Valor máximo deve ser maior ou igual ao mínimo')
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      const response = await axios.get<{ candidates: InvoiceMatchCandidate[]; truncated: boolean }>(
        '/api/invoice-payment-matches/search-statements',
        {
          params: {
            start_date: startDate,
            end_date: endDate,
            min_amount: minAmount,
            max_amount: maxAmount,
          },
        },
      )
      setSearchCandidates(response.data.candidates ?? [])
      setTruncated(Boolean(response.data.truncated))
      setSearched(true)
      setSelectedId(undefined)
    } catch (err: any) {
      setSearchError(err.response?.data?.detail || 'Erro ao pesquisar o extrato')
    } finally {
      setSearching(false)
    }
  }

  const visibleCandidates = searched ? searchCandidates : cycle.candidates
  const invoiceCents = centsOf(cycle.amount_to_pay)

  return (
    <aside className={`flex h-full min-h-0 w-full flex-col overflow-hidden bg-white dark:bg-gray-800 ${
      inline ? '' : 'max-w-md shrink-0 rounded-lg border border-gray-300 dark:border-gray-600'
    }`}>
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-1)]">
            Extrato
          </p>
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{cycle.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {cycle.year_month} · {formatCurrency(cycle.amount_to_pay)} · {cycle.line_count} lançamentos
          </p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700" title="Fechar">
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-3">
        {cycle.status === 'unlinked' ? (
          <div className="rounded-lg px-3 py-3" style={{ background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}>
            <div className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <Ban size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-info)' }} />
              <div>
                <p className="font-medium">Não vinculado</p>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  Este ciclo não tem e não terá débito no extrato. A Saúde não trata como pendente.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onUnmatch}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
              Voltar a pendente
            </button>
          </div>
        ) : cycle.status === 'matched' && cycle.match ? (
          <div className="rounded-lg bg-green-50 px-3 py-3 dark:bg-green-900/20">
            <div className="flex items-start gap-2 text-sm text-green-800 dark:text-green-300">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{formatDate(cycle.match.date)} · {formatCurrency(Math.abs(Number(cycle.match.amount || 0)))}</p>
                <p className="mt-0.5 text-xs">{cycle.match.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onUnmatch}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
              Desfazer vínculo
            </button>
          </div>
        ) : (
          <>
            {cycle.multiple_debits ? (
              <div
                className="mb-3 rounded-lg px-3 py-3"
                style={{ background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' }}
              >
                <div className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-warning)' }} />
                  <div>
                    <p className="font-medium">Vínculo automático não feito</p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                      O valor da fatura aparece em mais de um débito no extrato. Escolha o lançamento correto.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mb-3 text-xs text-gray-500">
                Primeiro buscamos débitos com o valor exato. Se o pagamento foi a menor, pesquise por período e faixa de valor.
              </p>
            )}

            <div className="mb-3 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <CadastroFieldLabel>Início</CadastroFieldLabel>
                  <BrazilianDatePicker
                    value={startDate}
                    onChange={setStartDate}
                    maxDate={parseLocalDate(endDate) ?? undefined}
                    className={cadastroFieldCls}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <CadastroFieldLabel>Fim</CadastroFieldLabel>
                  <BrazilianDatePicker
                    value={endDate}
                    onChange={setEndDate}
                    minDate={parseLocalDate(startDate) ?? undefined}
                    className={cadastroFieldCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <CadastroFieldLabel>Valor mínimo</CadastroFieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatAmountMask(minAmountCents)}
                      onChange={(e) => applyCentsMask(e.target.value, setMinAmountCents)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void runSearch()
                        }
                      }}
                      placeholder="0,00"
                      className={`${cadastroFieldCls} pl-9`}
                    />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <CadastroFieldLabel>Valor máximo</CadastroFieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatAmountMask(maxAmountCents)}
                      onChange={(e) => applyCentsMask(e.target.value, setMaxAmountCents)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void runSearch()
                        }
                      }}
                      placeholder="0,00"
                      className={`${cadastroFieldCls} pl-9`}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Débitos no período com valor entre o mínimo e o máximo.
              </p>
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching || busy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
              >
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Pesquisar extrato
              </button>
            </div>

            {searchError ? (
              <p className="mb-3 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {searchError}
              </p>
            ) : null}

            {!searched && cycle.candidates.length === 0 ? (
              <p className="flex items-start gap-1.5 text-xs text-gray-500">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                Nenhum débito com o valor exato na janela. Use a busca acima para pagamentos a menor.
              </p>
            ) : visibleCandidates.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhum lançamento neste filtro.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {searched ? 'Resultados da busca' : 'Valor exato'}
                </p>
                {truncated ? (
                  <p className="text-[11px] text-gray-400">Mostrando os 200 primeiros. Ajuste o período ou o valor.</p>
                ) : null}
                {visibleCandidates.map((candidate) => {
                  const id = Number(candidate.bank_statement_id)
                  const checked = selectedId === id
                  const paidCents = centsOf(candidate.amount)
                  const relative = monthLabel(candidate.month_relative)
                  return (
                    <label
                      key={id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                        checked
                          ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_8%,transparent)]'
                          : 'border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setSelectedId(e.target.checked ? id : undefined)}
                        className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 ${cadastroAccentControlCls}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {formatDate(candidate.date)} · {formatCurrency(Math.abs(candidate.amount))}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {candidate.description}
                          {relative ? ` · ${relative}` : ''}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {candidate.has_card_tag ? (
                            <Badge
                              variant={badgeVariantForColumnRole('scope')}
                              tone="brand1"
                              label="Tag Cartão"
                            />
                          ) : (
                            <span className="text-[11px] text-gray-400">sem tag Cartão — confirme</span>
                          )}
                          {paidCents < invoiceCents ? (
                            <Badge
                              variant={badgeVariantForColumnRole('statusPrimary')}
                              tone="warning"
                              label="A menor"
                            />
                          ) : null}
                          {paidCents > invoiceCents ? (
                            <Badge
                              variant={badgeVariantForColumnRole('statusPrimary')}
                              tone="info"
                              label="A maior"
                            />
                          ) : null}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {cycle.status !== 'matched' && cycle.status !== 'unlinked' && (
        <div className="shrink-0 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              disabled={!selectedId || busy}
              onClick={() => selectedId && onConfirm(selectedId)}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Vincular
            </button>
            {onSkip ? (
              <button
                type="button"
                disabled={busy}
                onClick={onSkip}
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-delete)', color: 'var(--on-color-delete)' }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                Não vincular
              </button>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  )
}
