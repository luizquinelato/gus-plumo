import type { RefObject } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { ProjectionChartRow } from '../utils/consortiumExport'

export const EXPORT_CHART_COLORS = { end: 'var(--color-2)', contemplated: 'var(--color-1)' }

const compact = (value: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

/**
 * Gráficos da projeção desenhados fora da tela, só para serem rasterizados no PDF
 * (o modal de projeção não está aberto na exportação feita pela lista).
 */
const ConsortiumExportCharts = ({
  rows,
  parcelRef,
  balanceRef,
}: {
  rows: ProjectionChartRow[]
  parcelRef: RefObject<HTMLDivElement>
  balanceRef: RefObject<HTMLDivElement>
}) => {
  const chart = (
    ref: RefObject<HTMLDivElement>,
    endKey: 'parcelNone' | 'balanceNone',
    contemplatedKey: 'parcel' | 'balance',
    type: 'stepAfter' | 'monotone',
  ) => (
    <div ref={ref} style={{ width: 760, height: 300, background: '#ffffff' }}>
      <LineChart width={760} height={300} data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF55" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={52} />
        <Line type={type} dataKey={endKey} stroke={EXPORT_CHART_COLORS.end} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line
          type={type}
          dataKey={contemplatedKey}
          stroke={EXPORT_CHART_COLORS.contemplated}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  )

  return (
    <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
      {chart(parcelRef, 'parcelNone', 'parcel', 'stepAfter')}
      {chart(balanceRef, 'balanceNone', 'balance', 'monotone')}
    </div>
  )
}

export default ConsortiumExportCharts
