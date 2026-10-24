import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RotateCcw, TrendingDown, TrendingUp } from 'lucide-react'
import MonthPicker from './MonthPicker'
import { listPageTableChromeFooterCls, listPageTableRowHoverCls, reportTableChromeHeaderCls } from './CadastroListPageLayout'
import {
  cadastroFieldCls,
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { formatCurrency, formatCurrencyWithColor } from '../utils/currency'
import {
  buildBase,
  defaultFuroTotal,
  DEFAULT_RATE_PCT,
  inputToYm,
  simulate,
  ymLabel,
  ymToInput,
  type ProjectionConsortium,
  type Scenario,
} from '../utils/consortiumProjection'

type ModalConsortium = ProjectionConsortium & {
  company_label: string
  group_code: string
  quota: string
  paid_installments: number
  remaining_installments: number
}

const SCENARIO_COLORS = ['var(--color-2)', 'var(--color-1)', 'var(--color-2)', 'var(--color-3)']

const num = (value: string): number => {
  const parsed = parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const compact = (value: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const pctText = (value: number | null) =>
  value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/** Variação (%) em relação ao outro cenário: seta + cor (verde = melhor, vermelho = pior). */
const Delta = ({ current, base, goodWhenUp }: { current: number; base: number; goodWhenUp: boolean }) => {
  if (current === base) {
    return (
      <span
        className="inline-flex items-center text-sm font-semibold text-gray-500 dark:text-gray-400"
        title="Sem diferença"
      >
        0%
      </span>
    )
  }
  if (!base) return null
  const pct = ((current - base) / Math.abs(base)) * 100
  const up = pct > 0
  const good = up === goodWhenUp
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${
        good ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
      }`}
      title="Diferença do contemplado em relação ao sem contemplação"
    >
      <Icon size={14} />
      {up ? '+' : ''}
      {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  )
}

/** Estilo de tabela igual ao das telas de relatório (Extrato). */
const REPORT_TH =
  'px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 whitespace-nowrap dark:text-gray-300'
const REPORT_ROW = `${listPageTableRowHoverCls} border-t border-t-gray-200 border-l-4 border-l-gray-300 dark:border-t-gray-700 dark:border-l-gray-600`
const REPORT_TD = 'px-3 py-4 text-left text-sm tabular-nums whitespace-nowrap'

type ScenarioEntry = { key: string; label: string; color: string; scenario: Scenario }

/** Comparativo em tabela: métrica × (contemplado | sem contemplação | variação do contemplado sobre o sem contemplação). */
const ScenarioTable = ({
  contemplated: cEntry,
  none: nEntry,
  contemplatedDate,
  noneDate,
}: {
  contemplated: ScenarioEntry
  none: ScenarioEntry
  /** Mês em que o crédito é recebido em cada cenário (MM/AAAA). */
  contemplatedDate: string
  noneDate: string
}) => {
  const c = cEntry.scenario
  const n = nEntry.scenario
  const cur = (v: number | null | undefined, hide = false) =>
    v == null || hide ? '—' : formatCurrencyWithColor(-v)
  const delta = (a: number | null, b: number | null, goodWhenUp: boolean) =>
    a != null && b != null ? <Delta current={a} base={b} goodWhenUp={goodWhenUp} /> : null

  // Antecipação: quantos meses antes do fim do plano o crédito é recebido na contemplação.
  const months = c.contemplationIdx != null ? n.points.length - 1 - c.contemplationIdx : 0
  const anticipation = (
    <span className="font-medium text-gray-700 dark:text-gray-300">
      {months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'} antes do fim` : 'No fim do plano'}
    </span>
  )

  // Parcelas: início (1º mês do gráfico), após a contemplação (só no contemplado) e fim (último mês).
  const lastIdx = n.points.length - 1
  // Contemplado na última parcela: o furo é pago logo depois dela e já abateu o saldo. Para comparar com o
  // "Ao final" (cujo saldo ainda inclui o furo), soma o furo de volta ao saldo mostrado.
  const contemplatedAtEnd = c.contemplationIdx != null && c.contemplationIdx >= lastIdx
  const cSettle = c.finalSettlement + (contemplatedAtEnd ? c.furoPaid : 0)

  type ParcelSteps = { start?: number; after?: number; end?: number }
  const afterIdx = c.contemplationIdx != null && c.contemplationIdx < lastIdx ? c.contemplationIdx + 1 : null
  const cParcels: ParcelSteps = {
    start: c.points[0]?.parcel,
    after: afterIdx != null ? c.points[afterIdx]?.parcel : undefined,
    end: c.points[lastIdx]?.parcel,
  }
  const nParcels: ParcelSteps = { start: n.points[0]?.parcel, end: n.points[lastIdx]?.parcel }
  const stepLine = (label: string, v?: number) => (
    <p className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{label}</span>
      <span>{v != null ? formatCurrencyWithColor(-v) : '—'}</span>
    </p>
  )
  const parcelLines = (p: ParcelSteps) => (
    <div className="space-y-1">
      {stepLine('Início', p.start)}
      {stepLine('Após', p.after)}
      {stepLine('Fim', p.end)}
    </div>
  )
  // Variação fim − início da própria coluna (parcela menor = verde).
  const startEndDelta = (p: ParcelSteps) =>
    p.start != null && p.end != null ? (
      <Delta current={p.end} base={p.start} goodWhenUp={false} />
    ) : (
      <span className="text-gray-400">—</span>
    )

  const rows: { label: string; c: ReactNode; n: ReactNode; delta?: ReactNode; strong?: boolean }[] = [
    { label: 'Data do crédito', c: contemplatedDate, n: noneDate, delta: anticipation },
    {
      label: 'Crédito recebido ao final',
      c: formatCurrencyWithColor(c.creditReceived),
      n: formatCurrencyWithColor(n.creditReceived),
      delta: delta(c.creditReceived, n.creditReceived, true),
      strong: true,
    },
    {
      label: 'Custo total',
      c: cur(c.totalCost),
      n: cur(n.totalCost),
      delta: delta(c.totalCost, n.totalCost, false),
      strong: true,
    },
    { label: 'Juros total', c: pctText(c.totalPct), n: pctText(n.totalPct), delta: delta(c.totalPct, n.totalPct, false) },
    { label: 'Juros a.a.', c: pctText(c.annualPct), n: pctText(n.annualPct), delta: delta(c.annualPct, n.annualPct, false) },
    {
      label: 'Parcelas',
      c: parcelLines(cParcels),
      n: parcelLines(nParcels),
      delta: (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">Ao final:</span>
            {startEndDelta(nParcels)}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">Contemplado:</span>
            {startEndDelta(cParcels)}
          </p>
        </div>
      ),
    },
    { label: 'Furo pago', c: cur(c.furoPaid, !(c.furoPaid > 0 && c.contemplationIdx != null) || contemplatedAtEnd), n: cur(n.furoPaid, true) },
    {
      label: 'Quitação no fim',
      c: cur(cSettle, !(cSettle > 0)),
      n: cur(n.finalSettlement, !(n.finalSettlement > 0)),
      // Só compara quando os dois têm quitação; com zero de um lado o % não faz sentido (−100% / indefinido).
      delta: cSettle > 0 && n.finalSettlement > 0 ? delta(cSettle, n.finalSettlement, false) : null,
    },
    {
      label: 'Saldo após última parcela',
      c: formatCurrencyWithColor(cSettle > 0 ? -cSettle : 0),
      n: formatCurrencyWithColor(n.finalSettlement > 0 ? -n.finalSettlement : 0),
      delta: cSettle > 0 && n.finalSettlement > 0 ? delta(cSettle, n.finalSettlement, false) : null,
    },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-auto">
        <thead className={reportTableChromeHeaderCls}>
          <tr>
            <th className={`${REPORT_TH} w-10 text-left`}>#</th>
            <th className={`${REPORT_TH} text-left`}>Métrica</th>
            <th className={`${REPORT_TH} text-left`}>
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: nEntry.color }}
              />
              Ao final
            </th>
            <th className={`${REPORT_TH} text-left`}>
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: cEntry.color }}
              />
              Contemplado
            </th>
            <th className={`${REPORT_TH} text-left`}>Variação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.label}
              className={REPORT_ROW}
              onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
            >
              <td className="px-3 py-4 text-left text-sm tabular-nums text-gray-500 dark:text-gray-400">{idx + 1}</td>
              <td className="px-3 py-4 text-left text-sm font-medium text-gray-800 dark:text-gray-100">{row.label}</td>
              <td className={`${REPORT_TD} ${row.strong ? 'font-semibold' : ''}`}>{row.n}</td>
              <td className={`${REPORT_TD} ${row.strong ? 'font-semibold' : ''}`}>{row.c}</td>
              <td className={REPORT_TD}>{row.delta ?? <span className="text-gray-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="p-0">
              <div className={`${listPageTableChromeFooterCls} text-sm text-gray-600 dark:text-gray-400`}>
                Variação: coluna Contemplado comparada com a coluna Ao final
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

interface ChartRow {
  label: string
  parcel: number
  /** Saldo após pagar a parcela do mês. */
  balance: number
  /** Saldo no início do mês (com reajuste), antes de pagar a parcela. */
  balanceBefore: number
  /** Mesmas séries no cenário sem contemplação. */
  parcelNone: number
  balanceNone: number
  balanceBeforeNone: number
  adjusted: boolean
  /** Furo pago no mês (contemplação); amortiza o saldo. */
  furoPaid: number
  isToday: boolean
}

const SummaryInfo = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="min-w-0">
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className="truncate text-base font-semibold text-gray-900 dark:text-white">{value}</p>
    {sub ? <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p> : null}
  </div>
)

const InputField = ({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) => (
  <div title={hint} className={className}>
    <CadastroFieldLabel>{label}</CadastroFieldLabel>
    <div className="mt-0.5">{children}</div>
  </div>
)

const ConsortiumProjectionModal = ({ consortium: c, onClose }: { consortium: ModalConsortium; onClose: () => void }) => {
  useEscapeKey(onClose, true)
  const [maximized, setMaximized] = useState(false)
  const base = useMemo(() => buildBase(c), [c])

  const initial = useMemo(() => {
    const rate = String(DEFAULT_RATE_PCT[c.segment] ?? 4.5)
    return {
      rate,
      reduction: c.reduction_factor != null ? String(c.reduction_factor) : '',
      // Total do furo: cadastrado (qtde × parcela) ou estimado pela diferença saldo − parcelas regulares.
      furo: base && defaultFuroTotal(c, base) > 0 ? String(defaultFuroTotal(c, base)) : '',
      contemplation: base ? ymToInput(base.firstYm) : '',
    }
  }, [c, base])

  const [rate, setRate] = useState(initial.rate)
  const [reduction, setReduction] = useState(initial.reduction)
  const [furo, setFuro] = useState(initial.furo)
  const furoTotal = Math.abs(num(furo))
  const [contemplation, setContemplation] = useState(initial.contemplation)
  const reset = useCallback(() => {
    setRate(initial.rate)
    setReduction(initial.reduction)
    setFuro(initial.furo)
    setContemplation(initial.contemplation)
  }, [initial])

  const scenarios = useMemo(() => {
    if (!base) return []
    const params = {
      creditRatePct: num(rate),
      balanceRatePct: num(rate),
      reductionPct: clamp(num(reduction), 0, 100),
      furoTotal,
    }
    const idx = clamp((inputToYm(contemplation) ?? base.firstYm) - base.firstYm, 0, base.remaining - 1)
    const list: Array<{ key: string; label: string; color: string; scenario: Scenario }> = [
      {
        key: 'c',
        label: `Contemplado em ${ymLabel(base.firstYm + idx)}`,
        color: SCENARIO_COLORS[1],
        scenario: simulate(base, params, idx),
      },
      { key: 'none', label: 'Sem contemplação', color: SCENARIO_COLORS[0], scenario: simulate(base, params, null) },
    ]
    return list
  }, [base, rate, reduction, furoTotal, contemplation])

  const contemplationLabel = base
    ? ymLabel(base.firstYm + clamp((inputToYm(contemplation) ?? base.firstYm) - base.firstYm, 0, base.remaining - 1))
    : ''
  const lastLabel = base ? ymLabel(base.firstYm + base.remaining - 1) : ''
  // Primeira metade do período: rótulo cresce para a direita; segunda metade: para a esquerda (evita corte).
  const contemplationIdx = base
    ? clamp((inputToYm(contemplation) ?? base.firstYm) - base.firstYm, 0, base.remaining - 1)
    : 0
  const labelPosition = base && contemplationIdx < base.remaining / 2 ? 'insideTopLeft' : 'insideTopRight'

  const chartData = useMemo(() => {
    if (!base) return []
    // Uma única linha: igual ao "como está" até a contemplação e, dali em diante, a mudança causada por ela.
    const contemplated = scenarios.find((s) => s.key === 'c')?.scenario
    const none = scenarios.find((s) => s.key === 'none')?.scenario
    if (!contemplated || !none || !base) return []
    // Ponto de partida: o mês atual (antes do próximo vencimento), com a parcela e o saldo de hoje.
    const round = (value: number) => Math.round(value * 100) / 100
    const today: ChartRow = {
      label: ymLabel(base.firstYm - 1),
      parcel: round(base.monthly),
      balance: round(base.balance),
      balanceBefore: round(base.balance),
      parcelNone: round(base.monthly),
      balanceNone: round(base.balance),
      balanceBeforeNone: round(base.balance),
      adjusted: false,
      furoPaid: 0,
      isToday: true,
    }
    return [
      today,
      ...contemplated.points.map<ChartRow>((point, i) => ({
        label: ymLabel(point.ym),
        parcel: round(point.parcel),
        balance: round(point.balance),
        balanceBefore: round(point.balanceBefore),
        parcelNone: round(none.points[i]?.parcel ?? point.parcel),
        balanceNone: round(none.points[i]?.balance ?? point.balance),
        balanceBeforeNone: round(none.points[i]?.balanceBefore ?? point.balanceBefore),
        adjusted: point.adjusted,
        furoPaid: round(point.furoPaid),
        isToday: false,
      })),
    ]
  }, [base, scenarios])

  const numberInput = (value: string, onChange: (v: string) => void, step = '0.1') => (
    <input type="number" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value)} className={cadastroFieldCls} />
  )

  const renderChart = (title: string, dataKey: 'parcel' | 'balance', type: 'stepAfter' | 'monotone') => (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      <ResponsiveContainer width="100%" height={maximized ? 380 : 260}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF55" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={52} />
          <Tooltip
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as ChartRow | undefined) : undefined
              if (!row) return null
              return (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  <p className="mb-1.5 text-sm font-bold text-gray-800 dark:text-gray-100">
                    {row.label}
                    {row.isToday ? ' · hoje' : ''}
                  </p>
                  {row.adjusted && (
                    <p className="mb-1.5 font-semibold text-amber-600 dark:text-amber-400">
                      Reajuste anual de {pctText(num(rate))} neste mês
                    </p>
                  )}
                  <div className="flex gap-4 text-gray-600 dark:text-gray-300">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-100">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SCENARIO_COLORS[0] }} />
                        Ao final
                      </p>
                      <p className="flex justify-between gap-4">
                        <span>Parcela do mês</span>
                        <strong>{formatCurrency(row.parcelNone)}</strong>
                      </p>
                      <p className="flex justify-between gap-4">
                        <span>{row.isToday ? 'Saldo hoje' : 'Saldo antes da parcela'}</span>
                        <strong>{formatCurrency(row.balanceBeforeNone)}</strong>
                      </p>
                      {!row.isToday && (
                        <p className="flex justify-between gap-4">
                          <span>Saldo após a parcela</span>
                          <strong>{formatCurrency(row.balanceNone)}</strong>
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5 border-l border-gray-200 pl-4 dark:border-gray-600">
                      <p className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-100">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SCENARIO_COLORS[1] }} />
                        Contemplado
                      </p>
                      <p className="flex justify-between gap-4">
                        <span>Parcela do mês</span>
                        <strong>{formatCurrency(row.parcel)}</strong>
                      </p>
                      <p className="flex justify-between gap-4">
                        <span>{row.isToday ? 'Saldo hoje' : 'Saldo antes da parcela'}</span>
                        <strong>{formatCurrency(row.balanceBefore)}</strong>
                      </p>
                      {row.furoPaid > 0 && (
                        <p className="flex justify-between gap-4 font-semibold text-amber-600 dark:text-amber-400">
                          <span>Furo pago após a parcela</span>
                          <strong>{formatCurrency(row.furoPaid)}</strong>
                        </p>
                      )}
                      {!row.isToday && (
                        <p className="flex justify-between gap-4">
                          <span>{row.furoPaid > 0 ? 'Saldo após parcela e furo' : 'Saldo após a parcela'}</span>
                          <strong>{formatCurrency(row.balance)}</strong>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            }}
          />
          <ReferenceLine x={contemplationLabel} stroke="var(--color-1)" strokeDasharray="4 4" label={{
              value: furoTotal > 0 ? `Contemplação + furo ${compact(furoTotal)}` : 'Contemplação',
              fontSize: 11,
              position: labelPosition,
            }} />
          <Legend verticalAlign="bottom" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <Line
            type={type}
            dataKey={dataKey === 'parcel' ? 'parcelNone' : 'balanceNone'}
            name="Ao final"
            stroke={SCENARIO_COLORS[0]}
            strokeWidth={2}
            dot={false}
          />
          <Line type={type} dataKey={dataKey} name="Contemplado" stroke={SCENARIO_COLORS[1]} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <CadastroModalShell maxWidth="max-w-6xl" maximized={maximized}>
      <CadastroModalHeader
        maximized={maximized}
        onToggleMaximize={() => setMaximized((prev) => !prev)}
        isEdit={false}
        title="Projeções"
        subtitle={`${c.company_label} · Grupo ${c.group_code} · Cota ${c.quota}`}
        icon={<TrendingUp size={18} />}
        iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
        onClose={onClose}
      />
      <CadastroModalBody>
        {!base ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Dados insuficientes para projetar (é preciso ter parcela, saldo devedor, crédito, parcelas em aberto e próximo vencimento).
          </p>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40 md:grid-cols-3 lg:grid-cols-6">
              <SummaryInfo label="Crédito" value={formatCurrencyWithColor(c.credit_amount ?? 0)} />
              <SummaryInfo label="Saldo devedor" value={formatCurrencyWithColor(c.outstanding_balance ?? 0)} />
              <SummaryInfo
                label="Parcela atual"
                value={formatCurrencyWithColor(c.monthly_amount ?? 0)}
                sub={c.reduction_factor != null ? `redução ${pctText(c.reduction_factor)}` : undefined}
              />
              <SummaryInfo label="Pagas" value={`${c.paid_installments} de ${c.plan_term_months}`} />
              <SummaryInfo
                label="Restantes"
                value={String(c.remaining_installments)}
                sub={`${c.open_regular_installments} regulares + ${c.catch_up_installments} furo`}
              />
              <SummaryInfo
                label="Próx. vencimento"
                value={c.next_due_date ? c.next_due_date.slice(0, 10).split('-').reverse().join('/') : '—'}
              />
            </div>

            <CadastroFormSection title="Premissas" icon={<TrendingUp size={14} />}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <InputField
                  label="Contemplação em"
                  hint={`Mês em que você recebe o crédito. Disponível de ${ymLabel(base.firstYm)} até ${lastLabel}.`}
                >
                  <MonthPicker
                    value={base.firstYm + contemplationIdx}
                    min={base.firstYm}
                    max={base.firstYm + base.remaining - 1}
                    onChange={(ym) => setContemplation(ymToInput(ym))}
                  />
                </InputField>
                <InputField label="Correção anual (% a.a.)" hint="Reajuste anual aplicado ao crédito, ao saldo devedor e à parcela">
                  {numberInput(rate, setRate)}
                </InputField>
                <InputField
                  label="Fator de redução até a contemplação (%)"
                  hint="Desconto na parcela até a contemplação. A parcela atual já tem a redução cadastrada embutida; mudar o fator recalcula a parcela (ex.: 0% = parcela cheia). Acima de 0 (ou com furo informado), depois da contemplação a parcela é recalculada: saldo ÷ parcelas restantes. Com 0 e sem furo, a parcela não muda e o furo é calculado automaticamente."
                >
                  {numberInput(reduction, setReduction, '0.01')}
                </InputField>
                <InputField
                  label="Total furo (R$)"
                  hint="Valor total do furo, pago de uma vez na contemplação, depois da parcela do mês, e abatido do saldo. Deixe 0 (e redução 0) para o furo ser calculado automaticamente: é o que as parcelas até o último vencimento não cobrem, pago na contemplação, sem aumentar a parcela."
                >
                  {numberInput(furo, setFuro, '0.01')}
                </InputField>
              </div>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                A contemplação em {contemplationLabel} é a virada de chave: nesse mês você paga a parcela atual e, depois dela, o total
                do furo (se houver) é pago de uma vez e amortiza o saldo. A nova parcela vale a partir do mês seguinte: com fator
                de redução ou furo informado ela é refeita pelo saldo (já amortizado) ÷ parcelas restantes; sem os dois, a parcela não muda e o furo é calculado sozinho: é o que as parcelas até o último vencimento não cobrem, pago na contemplação (o saldo zera no fim). Sem contemplação, a parcela só segue a correção
                anual, o furo não entra e o saldo que sobrar é quitado no fim do plano ({lastLabel}). As taxas são premissas suas (não vêm do extrato) e a edição aqui
                não é salva.
              </p>
            </CadastroFormSection>

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {renderChart('Valor da parcela por mês', 'parcel', 'stepAfter')}
              {renderChart('Saldo devedor projetado (após pagar a parcela do mês)', 'balance', 'monotone')}
            </div>

            {scenarios.length === 2 && (
              <CadastroFormSection title="Cenários" icon={<TrendingUp size={14} />} className="mt-5" bodyClassName="p-0">
                <ScenarioTable
                  contemplated={scenarios[0]}
                  none={scenarios[1]}
                  contemplatedDate={contemplationLabel}
                  noneDate={lastLabel}
                />
              </CadastroFormSection>
            )}
          </>
        )}
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        hideSave
        closeLabel="Fechar"
        leading={
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <RotateCcw size={14} />
            Restaurar padrões
          </button>
        }
      />
    </CadastroModalShell>
  )
}

export default ConsortiumProjectionModal
