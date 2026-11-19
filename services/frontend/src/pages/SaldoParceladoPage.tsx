import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Sidebar from '../components/Sidebar'
import MobileReportFilterBar from '../components/MobileReportFilterBar'
import SaldoParceladoMobileItemList from '../components/SaldoParceladoMobileItemList'
import { useDeviceMode } from '../contexts/DeviceModeContext'
import { useMobileTopBarActions } from '../contexts/MobileTopBarActionsContext'
import {
  CadastroFilterField,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageShell,
  MOBILE_REPORT_INSET_CLS,
  MOBILE_REPORT_SHELL_CLS,
  cadastroFilterFieldCls,
  listPageTableCls,
  listPageTableChromeFooterBgCls,
  listPageTableRowHoverCls,
  listPageTableSectionCls,
  listPageTableTdCls,
  listPageTableThCls,
  reportTableChromeHeaderCls,
} from '../components/CadastroListPageLayout'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import ExtratoReportMenu from '../components/ExtratoReportMenu'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { exportSaldoParceladoToPdf } from '../utils/exportSaldoParceladoPdf'
import { exportSaldoParceladoToExcel } from '../utils/exportSaldoParceladoExcel'
import {
  captureChartImage,
  type SaldoExportLegendEntry,
  type SaldoParceladoExportData,
} from '../utils/saldoParceladoExportShared'
import { CadastroModalHeader, CadastroModalShell } from '../components/CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import LoadingSpinner from '../components/LoadingSpinner'
import { useExportRunner } from '../hooks/useExportRunner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { formatCurrency } from '../utils/currency'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  CreditCard,
  Filter,
  Landmark,
  Layers,
  Maximize2,
  Receipt,
  Tag as TagIcon,
  Tags,
  Users,
  Wallet,
  X,
} from 'lucide-react'

interface TagOption {
  id: number
  name: string
}

interface SubtagOption {
  id: number
  name: string
  tag_id: number
}

interface CardOption {
  id: number
  name: string
  number: string
  type?: string
  active?: boolean
}

interface PartnerOption {
  id: number
  shared_account_id: number
  shared_account?: {
    id: number
    name?: string
    description?: string
    bank?: { name?: string } | null
    agency?: string
    account_number?: string
  }
}

interface InstallmentItem {
  id: number
  description: string
  purchase_date: string | null
  card_id: number
  card_name: string
  card_number: string
  issuer: 'btg' | 'mercadopago' | null
  subtag_id: number | null
  subtag_name: string | null
  tag_name: string | null
  shared_partner_id: number | null
  shared_partner_name: string | null
  ownership_percentage: number
  installment_amount: number
  full_installment_amount: number
  remaining_total: number
  full_remaining_total: number
  current_installment: number
  total_installments: number
  remaining_installments: number
  last_year_month: string
  first_projected_month: string
  last_projected_month: string
}

interface MonthProjection {
  year_month: string
  month_label: string
  total: number
  count: number
  remaining_after: number
  by_card?: Record<string, number>
}

interface CardSummary {
  card_id: number
  card_name: string
  card_number: string
  issuer: 'btg' | 'mercadopago' | null
  remaining_total: number
  purchases_count: number
}

interface InstallmentsReport {
  share: 'mine' | 'total'
  horizon_months: number
  months_truncated: boolean
  summary: {
    future_total: number
    next_month_total: number
    next_month: string | null
    next_month_label: string | null
    purchases_count: number
    remaining_installments_count: number
    last_projected_month: string | null
    last_projected_month_label: string | null
    months_count: number
  }
  months: MonthProjection[]
  cards: CardSummary[]
  items: InstallmentItem[]
}

const ISSUER_FILTER_OPTIONS = [
  { id: 1, name: 'BTG', code: 'btg' as const },
  { id: 2, name: 'Mercado Pago', code: 'mercadopago' as const },
]

const HORIZON_OPTIONS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
  { value: '0', label: 'Até o fim' },
]

type ItemSortField =
  | 'card'
  | 'description'
  | 'tag'
  | 'subtag'
  | 'sharing'
  | 'installments'
  | 'installment_amount'
  | 'remaining_total'
  | 'until'

function SortableTh({
  label,
  field,
  currentField,
  direction,
  onSort,
  align = 'left',
}: {
  label: string
  field: ItemSortField
  currentField: ItemSortField | null
  direction: 'asc' | 'desc'
  onSort: (field: ItemSortField) => void
  align?: 'left' | 'center' | 'right'
}) {
  const active = currentField === field
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const flexCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <th
      onClick={() => onSort(field)}
      className={`${listPageTableThCls} ${alignCls} cursor-pointer select-none transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/50`}
    >
      <span className={`inline-flex items-center gap-1 ${flexCls}`}>
        <span>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp size={13} className="shrink-0 text-[var(--color-1)]" />
          ) : (
            <ArrowDown size={13} className="shrink-0 text-[var(--color-1)]" />
          )
        ) : (
          <ArrowUpDown size={13} className="shrink-0 text-gray-400 opacity-40" />
        )}
      </span>
    </th>
  )
}

const cssVar = (name: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const CARD_CHART_COLORS = [
  '#2563eb', // azul
  '#7c3aed', // roxo
  '#059669', // esmeralda
  '#d97706', // âmbar
  '#db2777', // rosa
  '#0891b2', // ciano
  '#ea580c', // laranja
  '#4f46e5', // índigo
  '#10b981', // verde claro
  '#e11d48', // vermelho carmim
]

const chartTooltipStyle = {
  backgroundColor: 'var(--bg-card, #fff)',
  border: '1px solid var(--border-color, #e5e7eb)',
  borderRadius: '8px',
}

const scorecardCls =
  'rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800'
const chartCardCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'

export default function SaldoParceladoPage() {
  const { isMobile } = useDeviceMode()
  const { setActions } = useMobileTopBarActions()
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [cards, setCards] = useState<CardOption[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [subtags, setSubtags] = useState<SubtagOption[]>([])
  const [partners, setPartners] = useState<PartnerOption[]>([])

  const [selectedIssuerIds, setSelectedIssuerIds] = useState<number[]>([])
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([])
  const [horizon, setHorizon] = useState('12')
  const [share, setShare] = useState<'mine' | 'total'>('total')
  const [chartMode, setChartMode] = useState<'consolidated' | 'by_card'>('consolidated')
  const [chartMax, setChartMax] = useState(false)
  const closeChartMax = useCallback(() => setChartMax(false), [])
  useEscapeKey(closeChartMax, chartMax)
  const [itemSortField, setItemSortField] = useState<ItemSortField>('card')
  const [itemSortDirection, setItemSortDirection] = useState<'asc' | 'desc'>('asc')

  const [report, setReport] = useState<InstallmentsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const exportRunner = useExportRunner(setError)
  const chartCardRef = useRef<HTMLDivElement>(null)

  const colors = useMemo(
    () => ({
      primary: cssVar('--color-1', '#2563eb'),
      secondary: cssVar('--color-2', '#7c3aed'),
      danger: cssVar('--color-danger', '#dc2626'),
    }),
    [],
  )

  const tagOptions = useMemo(
    () => [{ id: -1, name: '(Vazio)' }, ...tags],
    [tags],
  )

  const filteredSubtags = useMemo(() => {
    if (selectedTagIds.length === 0) return []
    return subtags.filter((s) => selectedTagIds.includes(s.tag_id))
  }, [selectedTagIds, subtags])

  const partnerOptions = useMemo(() => {
    const options = partners
      .map((p) => ({
        id: p.id,
        name: p.shared_account?.name || p.shared_account?.description || `Conta #${p.shared_account_id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return [
      { id: -2, name: 'Minha Parte (próprio + compartilhado)' },
      { id: -1, name: 'Próprio (100% meu)' },
      ...options,
    ]
  }, [partners])

  const hasActiveFilters =
    selectedIssuerIds.length > 0 ||
    selectedCardIds.length > 0 ||
    selectedTagIds.length > 0 ||
    selectedSubtagIds.length > 0 ||
    selectedPartnerIds.length > 0 ||
    horizon !== '12' ||
    share !== 'total'

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string | number | boolean> = {
        horizon_months: Number(horizon),
        share,
      }
      if (selectedCardIds.length > 0) params.card_ids = selectedCardIds.join(',')
      if (selectedIssuerIds.length > 0) {
        const codes = selectedIssuerIds
          .map((id) => ISSUER_FILTER_OPTIONS.find((option) => option.id === id)?.code)
          .filter((code): code is 'btg' | 'mercadopago' => Boolean(code))
        if (codes.length > 0) params.issuers = codes.join(',')
      }
      const realTagIds = selectedTagIds.filter((id) => id !== -1)
      const realSubtagIds = selectedSubtagIds.filter((id) => id !== -1)
      if (realSubtagIds.length > 0) params.subtag_ids = realSubtagIds.join(',')
      else if (realTagIds.length > 0) params.tag_ids = realTagIds.join(',')
      if (selectedTagIds.includes(-1)) params.include_empty_tag = true
      const realPartnerIds = selectedPartnerIds.filter((id) => id !== -1)
      if (realPartnerIds.length > 0) params.partner_ids = realPartnerIds.join(',')
      if (selectedPartnerIds.includes(-1)) params.include_empty_sharing = true

      const response = await axios.get<InstallmentsReport>('/api/reports/installments', { params })
      setReport(response.data)
    } catch (err) {
      console.error('Erro ao carregar saldo parcelado:', err)
      setError('Não foi possível carregar o saldo parcelado.')
    } finally {
      setLoading(false)
    }
  }, [horizon, selectedCardIds, selectedIssuerIds, selectedPartnerIds, selectedSubtagIds, selectedTagIds, share])

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [cardsRes, tagsRes, subtagsRes, partnersRes] = await Promise.all([
          axios.get('/api/cartoes', { params: { incluir_inativos: true } }),
          axios.get('/api/reports/tags'),
          axios.get('/api/reports/subtags'),
          axios.get('/api/expense-sharing/'),
        ])
        setCards(
          (cardsRes.data as CardOption[]).filter((c) => (c.type ?? 'credito') === 'credito'),
        )
        setTags(tagsRes.data)
        setSubtags(subtagsRes.data)
        setPartners(partnersRes.data)
      } catch (err) {
        console.error('Erro ao carregar filtros:', err)
      } finally {
        setOptionsLoading(false)
      }
    }
    void loadOptions()
  }, [])

  const clearFilters = () => {
    setSelectedIssuerIds([])
    setSelectedCardIds([])
    setSelectedTagIds([])
    setSelectedSubtagIds([])
    setSelectedPartnerIds([])
    setHorizon('12')
    setShare('total')
  }

  const summary = report?.summary

  const cardColorMap = useMemo(() => {
    const map = new Map<number, string>()
    ;(report?.cards ?? [])
      .filter((c) => share !== 'mine' || Number(c.remaining_total) > 0)
      .forEach((c, idx) => {
        map.set(c.card_id, CARD_CHART_COLORS[idx % CARD_CHART_COLORS.length])
      })
    return map
  }, [report?.cards, share])

  const chartData = useMemo(() => {
    return (report?.months ?? []).map((month) => {
      const entry: Record<string, any> = {
        ...month,
        label: month.month_label,
      }
      if (month.by_card) {
        for (const [cardId, val] of Object.entries(month.by_card)) {
          entry[`card_${cardId}`] = Number(val)
        }
      }
      return entry
    })
  }, [report?.months])

  const shareHint = share === 'mine' ? 'Minha parte' : 'Valor integral'

  const handleItemSort = (field: ItemSortField) => {
    if (itemSortField === field) {
      setItemSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setItemSortField(field)
      setItemSortDirection('asc')
    }
  }

  const sortedItems = useMemo(() => {
    let list = [...(report?.items ?? [])]
    if (share === 'mine') {
      list = list.filter((item) => Number(item.installment_amount) > 0 && Number(item.remaining_total) > 0)
    }
    if (!itemSortField) return list

    list.sort((a, b) => {
      let cmp = 0
      switch (itemSortField) {
        case 'card': {
          const cardA = `${a.card_name} • ${a.card_number}`
          const cardB = `${b.card_name} • ${b.card_number}`
          cmp = cardA.localeCompare(cardB, 'pt-BR')
          break
        }
        case 'description':
          cmp = (a.description || '').localeCompare(b.description || '', 'pt-BR')
          break
        case 'tag':
          cmp = (a.tag_name || '').localeCompare(b.tag_name || '', 'pt-BR')
          break
        case 'subtag':
          cmp = (a.subtag_name || '').localeCompare(b.subtag_name || '', 'pt-BR')
          break
        case 'sharing': {
          const partA = a.shared_partner_name || ''
          const partB = b.shared_partner_name || ''
          cmp = partA.localeCompare(partB, 'pt-BR')
          if (cmp === 0) cmp = (a.ownership_percentage || 0) - (b.ownership_percentage || 0)
          break
        }
        case 'installments':
          cmp = a.remaining_installments - b.remaining_installments
          if (cmp === 0) cmp = a.total_installments - b.total_installments
          break
        case 'installment_amount':
          cmp = Number(a.installment_amount) - Number(b.installment_amount)
          break
        case 'remaining_total':
          cmp = Number(a.remaining_total) - Number(b.remaining_total)
          break
        case 'until':
          cmp = (a.last_projected_month || '').localeCompare(b.last_projected_month || '')
          break
      }
      return itemSortDirection === 'asc' ? cmp : -cmp
    })

    return list
  }, [report?.items, itemSortField, itemSortDirection])

  const exportReady = !loading && !error && !!report && report.items.length > 0 && !!summary

  /** Monta os dados exatamente como estão na tela (filtros, ordenação e modo do gráfico). */
  const buildExportData = async (): Promise<SaldoParceladoExportData | null> => {
    if (!report || !summary) return null
    const visibleCards = report.cards.filter((c) => share !== 'mine' || Number(c.remaining_total) > 0)
    const legend: SaldoExportLegendEntry[] =
      chartMode === 'consolidated'
        ? [{ name: 'Parcelas do mês', color: colors.primary, kind: 'bar' }]
        : visibleCards.map((c, i) => ({
            name: `${c.card_name} • ${c.card_number}`,
            color: cardColorMap.get(c.card_id) ?? CARD_CHART_COLORS[i % CARD_CHART_COLORS.length],
            kind: 'bar' as const,
          }))
    legend.push({ name: 'Saldo restante', color: colors.secondary, kind: 'line' })
    return {
      summary,
      months: report.months,
      cards: visibleCards,
      items: sortedItems,
      share,
      chartMode,
      monthsTruncated: report.months_truncated,
      chartImage: await captureChartImage(chartCardRef.current),
      legend,
      inactiveCardIds: new Set(cards.filter((c) => c.active === false).map((c) => c.id)),
    }
  }

  const handleExportPdf = () =>
    exportRunner.run('Gerando PDF…', async () => {
      const data = await buildExportData()
      if (data) await exportSaldoParceladoToPdf(data)
    })

  const handleExportExcel = () =>
    exportRunner.run('Gerando Excel…', async () => {
      const data = await buildExportData()
      if (data) await exportSaldoParceladoToExcel(data)
    })

  const chartModeToggle = (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800">
      {([['consolidated', 'Consolidado'], ['by_card', 'Por cartão']] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setChartMode(value)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
            chartMode === value
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const saldoActiveFilterCount = useMemo(() => {
    let n = 0
    if (selectedIssuerIds.length > 0) n += 1
    if (selectedCardIds.length > 0) n += 1
    if (selectedTagIds.length > 0) n += 1
    if (selectedSubtagIds.length > 0) n += 1
    if (selectedPartnerIds.length > 0) n += 1
    if (horizon !== '12') n += 1
    if (share !== 'total') n += 1
    return n
  }, [
    selectedIssuerIds.length,
    selectedCardIds.length,
    selectedTagIds.length,
    selectedSubtagIds.length,
    selectedPartnerIds.length,
    horizon,
    share,
  ])

  useEffect(() => {
    if (!isMobile) {
      setActions(null)
      return
    }
    setActions(
      <ExtratoReportMenu
        compact
        exportDisabled={!exportReady}
        onExportExcel={() => void handleExportExcel()}
        onExportPdf={() => void handleExportPdf()}
      />,
    )
    return () => setActions(null)
  }, [isMobile, setActions, exportReady, report, share, chartMode])

  const saldoFilterFields = (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CadastroFilterField label="Emissor" icon={<Landmark size={12} />}>
          <MultiSelectDropdown
            label="Emissor"
            options={ISSUER_FILTER_OPTIONS.map((option) => ({
              id: option.id,
              name: option.name,
              icon: <Landmark size={14} />,
              color: 'var(--color-1)',
            }))}
            selectedIds={selectedIssuerIds}
            onChange={setSelectedIssuerIds}
            placeholder="Selecione..."
          />
        </CadastroFilterField>

        <CadastroFilterField label="Cartões" icon={<CreditCard size={12} />}>
          <MultiSelectDropdown
            label="Cartões"
            options={cards.map((c) => ({
              id: c.id,
              name: `${c.name} • ${c.number}`,
              badge: c.active === false ? 'Inativo' : undefined,
              icon: <CreditCard size={14} />,
              color: 'var(--color-2)',
            }))}
            selectedIds={selectedCardIds}
            onChange={setSelectedCardIds}
            loading={optionsLoading}
            placeholder="Selecione..."
          />
        </CadastroFilterField>

        <CadastroFilterField label="Tag" icon={<TagIcon size={12} />}>
          <MultiSelectDropdown
            label="Tag"
            options={tagOptions}
            selectedIds={selectedTagIds}
            onChange={(ids) => {
              setSelectedTagIds(ids)
              if (!ids.some((id) => id !== -1)) setSelectedSubtagIds([])
            }}
            loading={optionsLoading}
            placeholder="Selecione..."
          />
        </CadastroFilterField>

        <CadastroFilterField label="Subtag" icon={<Tags size={12} />}>
          <MultiSelectDropdown
            label="Subtag"
            options={filteredSubtags}
            selectedIds={selectedSubtagIds}
            onChange={setSelectedSubtagIds}
            loading={optionsLoading}
            placeholder="Selecione..."
          />
        </CadastroFilterField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CadastroFilterField label="Compartilhamento" icon={<Users size={12} />}>
          <MultiSelectDropdown
            label="Compartilhamento"
            options={partnerOptions}
            selectedIds={selectedPartnerIds}
            onChange={setSelectedPartnerIds}
            loading={optionsLoading}
            placeholder="Selecione..."
            icon={<Users size={14} className="text-gray-500" />}
          />
        </CadastroFilterField>

        <CadastroFilterField label="Horizonte" icon={<CalendarClock size={12} />}>
          <select value={horizon} onChange={(e) => setHorizon(e.target.value)} className={cadastroFilterFieldCls}>
            {HORIZON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </CadastroFilterField>

        <CadastroFilterField label="Visão" icon={<Users size={12} />}>
          <select
            value={share}
            onChange={(e) => setShare(e.target.value as 'mine' | 'total')}
            className={cadastroFilterFieldCls}
          >
            <option value="mine">Minha parte</option>
            <option value="total">Valor integral</option>
          </select>
        </CadastroFilterField>
      </div>
    </>
  )

  const renderChart = (height: number | `${number}%`) => (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        margin={isMobile ? { top: 12, right: 4, left: -6, bottom: 8 } : { top: 16, right: 8, left: 0, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" stroke="#6b7280" fontSize={isMobile ? 10 : 12} angle={isMobile ? -30 : 0} textAnchor={isMobile ? 'end' : 'middle'} height={isMobile ? 46 : 30} />
        <YAxis
          tickFormatter={(value) => formatCurrency(Number(value))}
          stroke="#6b7280"
          fontSize={isMobile ? 9 : 11}
          width={isMobile ? 50 : 88}
        />
        <Tooltip
          formatter={(value: any, name: any) => {
            const num = Number(value || 0)
            if (num <= 0) return null
            return [formatCurrency(num), name]
          }}
          contentStyle={chartTooltipStyle}
        />
        <Legend wrapperStyle={isMobile ? { fontSize: 10 } : undefined} />
        {chartMode === 'consolidated' ? (
          <Bar dataKey="total" name="Parcelas do mês" fill={colors.primary} radius={[4, 4, 0, 0]} />
        ) : (
          (report?.cards ?? [])
            .filter((card) => share !== 'mine' || Number(card.remaining_total) > 0)
            .map((card, index) => (
              <Bar
                key={card.card_id}
                dataKey={`card_${card.card_id}`}
                name={`${card.card_name} • ${card.card_number}`}
                stackId="cards"
                fill={cardColorMap.get(card.card_id) ?? CARD_CHART_COLORS[index % CARD_CHART_COLORS.length]}
              />
            ))
        )}
        <Line
          type="monotone"
          dataKey="remaining_after"
          name="Saldo restante"
          stroke={colors.secondary}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )

  return (
    <div
      className={`flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900 ${MOBILE_REPORT_SHELL_CLS}`}
    >
      <Sidebar />

      <div className={MOBILE_REPORT_INSET_CLS}>
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Layers className="w-8 h-8" />}
              title="Saldo Parcelado"
              subtitle="Quanto ainda falta pagar das compras parceladas, mês a mês"
              actions={
                <CadastroListHeaderActions>
                  <div className="max-md:hidden">
                    <ExtratoReportMenu
                      exportDisabled={!exportReady}
                      onExportExcel={() => void handleExportExcel()}
                      onExportPdf={() => void handleExportPdf()}
                    />
                  </div>
                </CadastroListHeaderActions>
              }
            />
          }
          tabs={
            <div className="space-y-3">
              <div className="md:hidden">
                <MobileReportFilterBar
                  open={mobileFilterOpen}
                  onOpenChange={setMobileFilterOpen}
                  activeCount={saldoActiveFilterCount}
                  sheetTitle="Filtros do saldo parcelado"
                  onApply={() => void loadReport()}
                  onClear={clearFilters}
                  applyDisabled={loading || optionsLoading}
                >
                  {saldoFilterFields}
                </MobileReportFilterBar>
              </div>
              <div className="hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-[var(--color-1)] hover:shadow-md dark:border-gray-700 dark:bg-gray-800 md:block">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200">
                    <Filter size={18} className="text-[var(--color-1)]" />
                    Filtros
                  </h3>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={`flex items-center gap-1.5 text-sm font-semibold transition-all ${hasActiveFilters ? 'opacity-100 hover:opacity-80' : 'pointer-events-none opacity-0'}`}
                    style={{ color: 'var(--color-1)' }}
                  >
                    <X size={14} />
                    Limpar filtros
                  </button>
                </div>
                {saldoFilterFields}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void loadReport()}
                    disabled={loading || optionsLoading}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                  >
                    <Filter size={14} />
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          }
        >
          {loading && (
            <div className="rounded-xl border border-gray-200 bg-white py-16 dark:border-gray-700 dark:bg-gray-800">
              <LoadingSpinner message="Carregando saldo parcelado..." />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger)]" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Erro</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadReport()}
                  className="mt-3 text-sm font-semibold text-[var(--color-1)] underline"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          )}

          {!loading && !error && !report && (
            <CadastroListPageEmptyCard
              icon={<Filter className="h-10 w-10" />}
              title="Escolha os filtros e clique em Aplicar"
              description="O saldo parcelado é carregado somente após clicar em Aplicar."
            />
          )}

          {!loading && !error && report && report.items.length === 0 && (
            <CadastroListPageEmptyCard
              icon={<Layers className="h-10 w-10" />}
              title="Nenhum parcelamento em aberto"
              description="Não há parcelas futuras para os filtros selecionados."
            />
          )}

          {!loading && !error && report && report.items.length > 0 && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className={scorecardCls}>
                  <div className="flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-[var(--color-danger)]" />
                    <div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Saldo total parcelado</p>
                      <p className="text-xl font-bold tabular-nums text-[var(--color-danger)]">
                        {Math.abs(summary.future_total) >= 0.005
                          ? formatCurrency(-Math.abs(summary.future_total))
                          : formatCurrency(0)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    {shareHint} · não inclui a parcela já registrada na fatura-base
                  </p>
                </div>

                <div className={scorecardCls}>
                  <div className="flex items-center gap-3">
                    <CalendarClock className="h-5 w-5 text-[var(--color-danger)]" />
                    <div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Próximo período{summary.next_month_label ? ` · ${summary.next_month_label}` : ''}
                      </p>
                      <p className="text-xl font-bold tabular-nums text-[var(--color-danger)]">
                        {Math.abs(summary.next_month_total) >= 0.005
                          ? formatCurrency(-Math.abs(summary.next_month_total))
                          : formatCurrency(0)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Primeira competência após a fatura-base
                  </p>
                </div>

                <div className={scorecardCls}>
                  <div className="flex items-center gap-3">
                    <Receipt className="h-5 w-5 text-[var(--color-1)]" />
                    <div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Compras em aberto</p>
                      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">
                        {summary.purchases_count}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    {summary.remaining_installments_count} parcelas a vencer
                  </p>
                </div>

                <div className={scorecardCls}>
                  <div className="flex items-center gap-3">
                    <Layers className="h-5 w-5 text-[var(--color-1)]" />
                    <div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Última parcela</p>
                      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">
                        {summary.last_projected_month_label ?? '—'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    {summary.months_count} {summary.months_count === 1 ? 'mês' : 'meses'} com parcelas
                  </p>
                </div>
              </div>

              <div className={chartCardCls} ref={chartCardRef}>
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                      Projeção mês a mês
                    </h3>
                    <p className="text-xs text-gray-500">
                      {chartMode === 'consolidated'
                        ? 'Barras: parcelas do mês · Linha: saldo que resta após o mês'
                        : 'Barras empilhadas por cartão · Linha: saldo que resta após o mês'}
                      {report.months_truncated ? ` · exibindo os primeiros ${report.months.length} meses` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {chartModeToggle}
                    <button
                      type="button"
                      onClick={() => setChartMax(true)}
                      title="Maximizar gráfico"
                      aria-label="Maximizar gráfico"
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
                {renderChart(isMobile ? 280 : 320)}
              </div>

              <div className={listPageTableSectionCls}>
                <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Parcelas por mês</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className={listPageTableCls}>
                    <thead className={reportTableChromeHeaderCls}>
                      <tr>
                        <th className={listPageTableThCls}>Mês</th>
                        <th className={`${listPageTableThCls} text-right`}>Parcelas</th>
                        <th className={`${listPageTableThCls} text-right`}>Total do mês</th>
                        <th className={`${listPageTableThCls} text-right`}>Saldo após o mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.months.map((month) => (
                        <tr key={month.year_month} className={listPageTableRowHoverCls}>
                          <td className={listPageTableTdCls}>{month.month_label}</td>
                          <td className={`${listPageTableTdCls} text-right tabular-nums`}>{month.count}</td>
                          <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}>
                            {formatCurrency(month.total)}
                          </td>
                          <td className={`${listPageTableTdCls} text-right tabular-nums text-gray-500`}>
                            {formatCurrency(month.remaining_after)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className={listPageTableChromeFooterBgCls}>
                      <tr>
                        <td className={`${listPageTableTdCls} font-semibold`}>Total projetado</td>
                        <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}>
                          {summary.remaining_installments_count}
                        </td>
                        <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}>
                          {formatCurrency(summary.future_total)}
                        </td>
                        <td className={listPageTableTdCls} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>


              <div className={listPageTableSectionCls}>
                <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Saldo por cartão</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className={listPageTableCls}>
                    <thead className={reportTableChromeHeaderCls}>
                      <tr>
                        <th className={listPageTableThCls}>Cartão</th>
                        <th className={`${listPageTableThCls} text-right`}>Compras</th>
                        <th className={`${listPageTableThCls} text-right`}>Saldo parcelado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.cards
                        .filter((card) => share !== 'mine' || Number(card.remaining_total) > 0)
                        .map((card) => (
                        <tr key={card.card_id} className={listPageTableRowHoverCls}>
                          <td className={listPageTableTdCls}>
                            <span className="flex items-center gap-2">
                              <CreditCard size={14} className="text-gray-400" />
                              {card.card_name} • {card.card_number}
                            </span>
                          </td>
                          <td className={`${listPageTableTdCls} text-right tabular-nums`}>{card.purchases_count}</td>
                          <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}>
                            {formatCurrency(card.remaining_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={listPageTableSectionCls}>
                <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Compras parceladas em aberto</h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Itens da última fatura disponível de cada cartão e suas parcelas futuras
                  </p>
                </div>
                {isMobile ? (
                  <SaldoParceladoMobileItemList items={sortedItems} />
                ) : (
                <div className="overflow-x-auto">
                  <table className={listPageTableCls}>
                    <thead className={reportTableChromeHeaderCls}>
                      <tr>
                        <SortableTh
                          label="Cartão"
                          field="card"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                        <SortableTh
                          label="Descrição"
                          field="description"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                        <SortableTh
                          label="Tag"
                          field="tag"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                        <SortableTh
                          label="Subtag"
                          field="subtag"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                        <SortableTh
                          label="Compartilhamento"
                          field="sharing"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                        <SortableTh
                          label="Parcelas futuras"
                          field="installments"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                          align="center"
                        />
                        <SortableTh
                          label="Valor da parcela"
                          field="installment_amount"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                          align="right"
                        />
                        <SortableTh
                          label="Saldo restante"
                          field="remaining_total"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                          align="right"
                        />
                        <SortableTh
                          label="Até"
                          field="until"
                          currentField={itemSortField}
                          direction={itemSortDirection}
                          onSort={handleItemSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedItems.map((item) => {
                        const hasRemaining = Math.abs(item.remaining_total) >= 0.005
                        return (
                          <tr key={item.id} className={listPageTableRowHoverCls}>
                            <td className={listPageTableTdCls}>
                              <span className="flex items-center gap-1.5 whitespace-nowrap">
                                <CreditCard size={13} className="shrink-0 text-gray-400" />
                                {item.card_name} • {item.card_number}
                                {cards.find((c) => c.id === item.card_id)?.active === false && (
                                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-600 dark:text-gray-200">
                                    Inativo
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className={listPageTableTdCls}>
                              <span className="block max-w-[22rem] truncate" title={item.description || undefined}>
                                {item.description || '—'}
                              </span>
                            </td>
                            <td className={listPageTableTdCls}>{item.tag_name || '—'}</td>
                            <td className={listPageTableTdCls}>{item.subtag_name || '—'}</td>
                            <td className={listPageTableTdCls}>
                              <SharedAccountDisplay
                                account={
                                  item.shared_partner_name
                                    ? { id: item.shared_partner_id || 0, name: item.shared_partner_name }
                                    : null
                                }
                                ownershipPercentage={item.ownership_percentage}
                              />
                            </td>
                            <td className={`${listPageTableTdCls} text-center tabular-nums`}>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">
                                {item.remaining_installments}
                              </span>
                              <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                                ({item.current_installment}/{item.total_installments})
                              </span>
                            </td>
                            <td
                              className={`${listPageTableTdCls} text-right tabular-nums ${
                                Math.abs(item.installment_amount) >= 0.005
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-gray-900 dark:text-white'
                              }`}
                            >
                              {Math.abs(item.installment_amount) >= 0.005
                                ? formatCurrency(-Math.abs(item.installment_amount))
                                : formatCurrency(0)}
                            </td>
                            <td
                              className={`${listPageTableTdCls} text-right font-semibold tabular-nums ${
                                hasRemaining ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                              }`}
                            >
                              {hasRemaining
                                ? formatCurrency(-Math.abs(item.remaining_total))
                                : formatCurrency(0)}
                            </td>
                            <td className={`${listPageTableTdCls} tabular-nums`}>
                              {item.last_projected_month || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>
      </div>
      {chartMax && (
        <CadastroModalShell maxWidth="max-w-6xl">
          <CadastroModalHeader
            isEdit={false}
            title="Projeção mês a mês"
            onClose={closeChartMax}
            icon={<Layers size={18} />}
          />
          <div className="flex items-center justify-end px-6 pt-3">{chartModeToggle}</div>
          <div className="h-[65vh] min-h-0 px-6 pb-4 pt-2">{renderChart('100%')}</div>
        </CadastroModalShell>
      )}
      {exportRunner.overlay}
    </div>
  )
}
