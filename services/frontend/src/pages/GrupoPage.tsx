import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import LoadingSpinner from '../components/LoadingSpinner'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Layers, Search, X, Landmark, CreditCard, Gift, Filter, Calendar, ArrowUp, Users, FileText, Tag, Tags } from 'lucide-react'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { useExportRunner } from '../hooks/useExportRunner'
import { downloadExcel, excelDateStamp } from '../utils/excelExportClient'
import { downloadPdf, type PdfBlock } from '../utils/pdfExportClient'
import { DateField } from '../components/date'
import { dateToLocalString, parseLocalDate } from '../utils/dateUtils'
import { formatCurrency } from '../utils/currency'
import { MultiSelectDropdown, SourceMultiSelectDropdown } from '../components/MultiSelectDropdown'

// Interfaces
interface ExpenseDetail {
  id: number
  date: string
  description: string
  amount: number
  source: 'bank' | 'card' | 'benefit'
  card_number?: string | null
  card_name?: string | null
  category?: string | null
  subtag_id?: number | null
  subtag_name?: string | null
  tag_name?: string | null
  current_installment?: number | null
  total_installments?: number | null
  adjustment_type?: string | null
  ownership_percentage?: number | null
  shared_partner_id?: number | null
  shared_partner_name?: string | null
  shared_partner_bank?: string | null
  shared_partner_agency?: string | null
  shared_partner_account_number?: string | null
  account_id?: number | null
  account_name?: string | null
  bank_code?: string | null
  bank_name?: string | null
  year_month?: string | null  // Ano/mês da fatura (YYYY-MM) - usado apenas para faturas de cartão
}

type ChartTab = 'expense' | 'revenue'

interface ChartSlice {
  name: string
  value: number
  pct: number
}

const NO_TAG = '(Sem tag)'
const NO_SUBTAG = '(Sem subtag)'

// Por posição (maior valor primeiro): vermelho, laranja, amarelo; depois cores distintas.
// Tons escurecidos de laranja/amarelo para manterem contraste no tema claro.
const RANK_COLORS = [
  '#dc2626', // 1º - vermelho
  '#ea580c', // 2º - laranja
  '#ca8a04', // 3º - amarelo (âmbar escuro)
  '#2563eb', // azul
  '#7c3aed', // roxo
  '#0d9488', // verde-azulado
  '#db2777', // rosa
  '#0891b2', // ciano
  '#65a30d', // verde-limão
  '#4f46e5', // índigo
  '#92400e', // marrom
  '#be185d', // magenta
]
const NO_TAG_COLOR = '#374151' // cinza escuro
const OTHERS = 'Demais'
const OTHERS_COLOR = '#9ca3af' // cinza claro
const MAX_SLICES = 10

// Subtag do extrato que é detalhada pelos itens da fatura; sempre ignorada para não duplicar.
const BANK_CARD_SUBTAG = 'banco>cartao'
const normalizeName = (name?: string | null) =>
  (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
// Reconhece "Banco>Cartão" como nome da subtag ou como tag "Banco" + subtag "Cartão".
const isBankCardSubtag = (subtagName?: string | null, tagName?: string | null) => {
  const sub = normalizeName(subtagName)
  return sub === BANK_CARD_SUBTAG || (normalizeName(tagName) === 'banco' && sub === 'cartao')
}

const isNeutral = (name: string) => name === NO_TAG || name === NO_SUBTAG || name === OTHERS

// Fatias sem tag/subtag e "Demais" ficam cinza e não consomem posição na paleta.
const sliceColor = (slices: ChartSlice[], name: string) => {
  if (name === OTHERS) return OTHERS_COLOR
  if (name === NO_TAG || name === NO_SUBTAG) return NO_TAG_COLOR
  const rank = slices.filter((s) => !isNeutral(s.name)).findIndex((s) => s.name === name)
  return RANK_COLORS[rank % RANK_COLORS.length]
}

const truncateLabel = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s)

// Com `limit`, mantém as (limit - 1) maiores e agrupa o resto em "Demais".
const buildSlices = (map: Map<string, number>, limit?: number): ChartSlice[] => {
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0)
  const slices = Array.from(map.entries())
    .map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
  if (!limit || slices.length <= limit) return slices
  const rest = slices.slice(limit - 1)
  const value = rest.reduce((s, r) => s + r.value, 0)
  return [...slices.slice(0, limit - 1), { name: OTHERS, value, pct: total > 0 ? (value / total) * 100 : 0 }]
}

// Opções de fonte
const SOURCE_OPTIONS = [
  { id: 'bank', name: 'Extratos Bancários', icon: <Landmark size={14} />, color: 'var(--color-1)' },
  { id: 'card', name: 'Faturas de Cartão', icon: <CreditCard size={14} />, color: 'var(--color-2)' },
  { id: 'benefit', name: 'Cartões de Benefícios', icon: <Gift size={14} />, color: 'var(--color-3)' }
]

const GrupoPage = () => {
  // Estados de filtro
  const [selectedSources, setSelectedSources] = useState<string[]>([]) // Vazio = busca todas as fontes
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([])
  const [partners, setPartners] = useState<Array<{
    id: number
    shared_account_id: number
    shared_account?: { name?: string; description?: string }
  }>>([])
  const exportRunner = useExportRunner((message) => setError(message))
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [tags, setTags] = useState<Array<{ id: number; name: string }>>([])
  const [subtags, setSubtags] = useState<Array<{ id: number; name: string; tag_id: number; tag_name: string }>>([])

  const [tagsLoading, setTagsLoading] = useState(true)
  const [subtagsLoading, setSubtagsLoading] = useState(true)
  const [partnersLoading, setPartnersLoading] = useState(true)

  useEffect(() => {
    axios
      .get('/api/reports/tags')
      .then((response) => setTags(response.data))
      .catch((err) => console.error('Erro ao carregar tags:', err))
      .finally(() => setTagsLoading(false))
    axios
      .get('/api/reports/subtags')
      .then((response) => setSubtags(response.data))
      .catch((err) => console.error('Erro ao carregar subtags:', err))
      .finally(() => setSubtagsLoading(false))
  }, [])

  const tagOptions = useMemo(
    () => [{ id: -1, name: '(Vazio)' }, ...tags.map((t) => ({ id: t.id, name: t.name }))],
    [tags],
  )

  const subtagOptions = useMemo(() => {
    const realTagIds = selectedTagIds.filter((id) => id !== -1)
    if (realTagIds.length === 0) return []
    return subtags
      .filter((st) => realTagIds.includes(st.tag_id))
      .map((st) => {
        const ignored = isBankCardSubtag(st.name, st.tag_name)
        return {
          id: st.id,
          name: st.name,
          groupKey: st.tag_name,
          groupName: st.tag_name,
          disabled: ignored,
          badge: ignored ? 'Ignorada' : undefined,
        }
      })
  }, [subtags, selectedTagIds])

  useEffect(() => {
    axios
      .get('/api/expense-sharing/')
      .then((response) => setPartners(response.data))
      .catch((err) => console.error('Erro ao carregar parceiros:', err))
      .finally(() => setPartnersLoading(false))
  }, [])

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

  // Estados de dados
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Aba de gráficos e tag selecionada (filtra as subtags)
  const [chartTab, setChartTab] = useState<ChartTab>('expense')
  const [selectedChartTag, setSelectedChartTag] = useState<string | null>(null)
  const [limitSlices, setLimitSlices] = useState(true)

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Detecta scroll para mostrar/esconder botão Back to Top
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrolled = container.scrollTop > 300
      setShowBackToTop(scrolled)
    }

    // Verifica scroll inicial
    handleScroll()

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [expenses])

  // Função para voltar ao topo
  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Carrega dados
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()

      // Fontes - vazio = busca todas (combined)
      if (selectedSources.length === 0 || selectedSources.length === 3) {
        // Todas as fontes
        params.append('source', 'combined')
      } else {
        // 1 ou 2 fontes: o backend lê só `source`, com nomes separados por vírgula
        const sourceMap: Record<string, string> = { bank: 'bank', card: 'cards', benefit: 'benefits' }
        params.append('source', selectedSources.map((s) => sourceMap[s]).join(','))
      }

      // Datas
      if (startDate) params.append('start_date', dateToLocalString(startDate))
      if (endDate) params.append('end_date', dateToLocalString(endDate))

      const realPartnerIds = selectedPartnerIds.filter((id) => id !== -1)
      if (selectedPartnerIds.includes(-1)) params.append('include_empty_sharing', 'true')
      if (realPartnerIds.length > 0) params.append('partner_ids', realPartnerIds.join(','))

      if (selectedTagIds.includes(-1)) params.append('include_empty_tag', 'true')
      const realTagIds = selectedTagIds.filter((id) => id !== -1)
      if (realTagIds.length > 0) params.append('tag_ids', realTagIds.join(','))
      if (selectedSubtagIds.length > 0) params.append('subtag_ids', selectedSubtagIds.join(','))

      params.append('limit', '10000')

      const response = await axios.get(`/api/reports/detailed?${params}`)
      setExpenses(response.data.expenses || [])
    } catch (err: any) {
      console.error('Erro ao carregar dados:', err)
      setError(err.response?.data?.detail || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }

  // Dados dos gráficos: despesas (valores < 0) ou receitas (valores > 0), conforme a aba
  const chartData = useMemo(() => {
    const term = searchTerm.toLowerCase()
    const tagMap = new Map<string, number>()
    const subMap = new Map<string, number>()
    expenses
      .filter((exp) => !term || exp.description.toLowerCase().includes(term))
      .forEach((exp) => {
        const amount = Number(exp.amount) || 0
        if (chartTab === 'expense' ? amount >= 0 : amount <= 0) return
        if (isBankCardSubtag(exp.subtag_name, exp.tag_name)) return
        const value = Math.abs(amount)
        const tag = exp.tag_name || NO_TAG
        const subtag = exp.subtag_name || NO_SUBTAG
        tagMap.set(tag, (tagMap.get(tag) || 0) + value)
        if (!selectedChartTag || selectedChartTag === tag) {
          subMap.set(subtag, (subMap.get(subtag) || 0) + value)
        }
      })
    return {
      tagSlices: buildSlices(tagMap, limitSlices ? MAX_SLICES : undefined),
      subtagSlices: buildSlices(subMap, limitSlices ? MAX_SLICES : undefined),
    }
  }, [expenses, searchTerm, chartTab, selectedChartTag, limitSlices])

  const { tagSlices, subtagSlices } = chartData
  const hasResults = tagSlices.length > 0

  const renderChartCard = (title: string, slices: ChartSlice[], clickable: boolean) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-base font-bold text-gray-800 dark:text-gray-200 mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={520}>
        <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <Pie
            data={slices as unknown as Array<Record<string, unknown>>}
            dataKey="value"
            nameKey="name"
            outerRadius={170}
            minAngle={3}
            labelLine
            label={(p: { x: number; y: number; textAnchor?: 'start' | 'middle' | 'end' | 'inherit'; name?: string; payload?: ChartSlice }) => (
              <text
                x={p.x}
                y={p.y}
                textAnchor={p.textAnchor}
                dominantBaseline="central"
                fontSize={12}
                className="fill-gray-800 dark:fill-gray-200"
              >
                {`${truncateLabel(String(p.name ?? ''))} ${(p.payload?.pct ?? 0).toFixed(1)}%`}
              </text>
            )}
            onClick={(d: { name?: string }) => {
              if (clickable && d?.name && d.name !== OTHERS) setSelectedChartTag((prev) => (prev === d.name ? null : d.name!))
            }}
          >
            {slices.map((s) => (
              <Cell key={s.name} fill={sliceColor(slices, s.name)} cursor={clickable ? 'pointer' : 'default'} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 space-y-1">
        {slices.map((s) => (
          <div
            key={s.name}
            className={`flex items-center gap-2 text-sm ${clickable ? 'cursor-pointer' : ''}`}
            onClick={() => clickable && s.name !== OTHERS && setSelectedChartTag((prev) => (prev === s.name ? null : s.name))}
          >
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: sliceColor(slices, s.name) }} />
            <span className="w-14 text-right text-gray-500 dark:text-gray-400">{s.pct.toFixed(1)}%</span>
            <span className="flex-1 text-gray-800 dark:text-gray-200 truncate">{s.name}</span>
            <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const clearFilters = () => {
    setSelectedSources([]) // Vazio = busca todas as fontes
    setStartDate(null)
    setEndDate(null)
    setSearchTerm('')
    setSelectedPartnerIds([])
    setSelectedTagIds([])
    setSelectedSubtagIds([])
  }

  const typeLabel = chartTab === 'expense' ? 'Despesas' : 'Receitas'

  const handleExportExcel = () => {
    if (!hasResults) return
    void exportRunner.run('Gerando Excel…', () => {
      const sheet = (name: string, label: string, slices: ChartSlice[]) => ({
        name,
        rows: slices.map((s) => ({ [label]: s.name, '%': Number(s.pct.toFixed(2)), Valor: s.value })),
        columns: [label, '%', 'Valor'],
        kinds: { Valor: 'money' as const },
        pie: {
          title: `${typeLabel} por ${label}`,
          category_column: label,
          value_column: 'Valor',
          colors: slices.map((s) => sliceColor(slices, s.name)),
        },
      })
      return downloadExcel(`relatorio_grupos_${typeLabel.toLowerCase()}_${excelDateStamp()}.xlsx`, [
        sheet('Tags', 'Tag', tagSlices),
        sheet('Subtags', 'Subtag', subtagSlices),
      ])
    })
  }

  const handleExportPdf = () => {
    if (!hasResults) return
    void exportRunner.run('Gerando PDF…', () => {
      const table = (label: string, slices: ChartSlice[]): PdfBlock => ({
        type: 'table',
        columns: [
          { header: label },
          { header: '%', width_mm: 20, align: 'right' },
          { header: 'Valor', width_mm: 32, align: 'right' },
        ],
        rows: slices.map((s) => [s.name, `${s.pct.toFixed(1)}%`, formatCurrency(s.value)]),
        footer: ['Total', '', formatCurrency(slices.reduce((sum, s) => sum + s.value, 0))],
      })
      const pie = (slices: ChartSlice[]): PdfBlock => ({
        type: 'pie',
        slices: slices.map((s) => ({ name: s.name, value: s.value, color: sliceColor(slices, s.name) })),
      })
      const subtagHeading = selectedChartTag ? `Por Subtag — ${selectedChartTag}` : 'Por Subtag'
      return downloadPdf(`relatorio_grupos_${typeLabel.toLowerCase()}_${excelDateStamp()}.pdf`, {
        title: `Relatório por Tag/Subtag — ${typeLabel}`,
        blocks: [
          { type: 'heading', text: 'Por Tag' },
          pie(tagSlices),
          table('Tag', tagSlices),
          { type: 'page_break' },
          { type: 'heading', text: subtagHeading },
          pie(subtagSlices),
          table('Subtag', subtagSlices),
        ],
      })
    })
  }

  // Verifica se há filtros ativos
  const hasActiveFilters =
    selectedPartnerIds.length > 0 ||
    selectedTagIds.length > 0 ||
    selectedSubtagIds.length > 0 ||
    selectedSources.length > 0 || // alguma fonte específica selecionada
    startDate !== null ||
    endDate !== null ||
    searchTerm !== ''

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Layers className="w-8 h-8" />}
              title="Relatório por Grupo"
              subtitle="Distribuição de despesas e receitas por tag e subtag"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    menuTitle: 'Exportar',
                    exportDisabled: !hasResults,
                    onExportExcel: handleExportExcel,
                    extraItems: [
                      {
                        id: 'pdf',
                        label: 'Exportar PDF',
                        icon: <FileText size={16} />,
                        onClick: handleExportPdf,
                      },
                    ],
                  }}
                >
                  {null}
                </CadastroListHeaderActions>
              }
            />
          }
          tabs={
            <div className="space-y-4">
            {/* Filtros - Layout Compacto */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all hover:border-color-primary hover:shadow-md">
            {/* Header: Título + Link Limpar Filtros */}
            <div className="flex items-center justify-between mb-3">
              {/* Título */}
              <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200">
                <Filter size={18} className="text-color-primary" />
                Filtros
              </h3>
              {/* Link Limpar */}
              <button
                onClick={clearFilters}
                className={`flex items-center gap-1.5 text-sm font-semibold transition-all ${hasActiveFilters ? 'opacity-100 hover:opacity-80' : 'opacity-0 pointer-events-none'}`}
                style={{ color: 'var(--color-1)' }}
              >
                <X size={14} />
                Limpar filtros
              </button>
            </div>

            {/* Linha 1: Filtros principais */}
            <div className="flex items-end gap-3">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                {/* Fonte */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Landmark size={12} className="inline mr-1 text-color-primary" />
                    Fonte
                  </label>
                  <SourceMultiSelectDropdown
                    label="Fonte"
                    options={SOURCE_OPTIONS}
                    selectedIds={selectedSources}
                    onChange={setSelectedSources}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Compartilhamento */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Users size={12} className="inline mr-1 text-color-primary" />
                    Compartilhamento
                  </label>
                  <MultiSelectDropdown
                    label="Compartilhamento"
                    options={partnerOptions}
                    selectedIds={selectedPartnerIds}
                    onChange={setSelectedPartnerIds}
                    loading={partnersLoading}
                    placeholder="Selecione..."
                    icon={<Users size={14} className="text-gray-500" />}
                  />
                </div>

                {/* Tag */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Tag size={12} className="inline mr-1 text-color-primary" />
                    Tag
                  </label>
                  <MultiSelectDropdown
                    label="Tag"
                    options={tagOptions}
                    selectedIds={selectedTagIds}
                    onChange={(newTagIds) => {
                      setSelectedTagIds(newTagIds)
                      const realTagIds = newTagIds.filter((id) => id !== -1)
                      if (realTagIds.length === 0) {
                        setSelectedSubtagIds([])
                      } else {
                        const valid = subtags.filter((st) => realTagIds.includes(st.tag_id)).map((st) => st.id)
                        setSelectedSubtagIds((prev) => prev.filter((id) => valid.includes(id)))
                      }
                    }}
                    loading={tagsLoading}
                    placeholder="Selecione..."
                    icon={<Tag size={14} className="text-gray-500" />}
                  />
                </div>

                {/* Subtag */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Tags size={12} className="inline mr-1 text-color-primary" />
                    Subtag
                  </label>
                  <MultiSelectDropdown
                    label="Subtag"
                    options={subtagOptions}
                    selectedIds={selectedSubtagIds}
                    onChange={setSelectedSubtagIds}
                    loading={subtagsLoading}
                    placeholder={selectedTagIds.filter((id) => id !== -1).length === 0 ? 'Selecione uma tag primeiro' : 'Selecione...'}
                    groupByKey={selectedTagIds.filter((id) => id !== -1).length > 1}
                    disabled={selectedTagIds.filter((id) => id !== -1).length === 0}
                    icon={<Tags size={14} className="text-gray-500" />}
                  />
                </div>
              </div>
            </div>

            {/* Linha 2: Datas + Botão Aplicar */}
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <Calendar size={12} className="inline mr-1 text-color-primary" />
                  Data Início
                </label>
                <DateField
                  value={startDate ? dateToLocalString(startDate) : ''}
                  onChange={(value) => setStartDate(value ? parseLocalDate(value) : null)}
                  maxDate={endDate ?? undefined}
                  className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <Calendar size={12} className="inline mr-1 text-color-primary" />
                  Data Fim
                </label>
                <DateField
                  value={endDate ? dateToLocalString(endDate) : ''}
                  onChange={(value) => setEndDate(value ? parseLocalDate(value) : null)}
                  minDate={startDate ?? undefined}
                  className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all"
                />
              </div>
              <div className="flex items-end flex-shrink-0">
                <button
                  onClick={loadData}
                  disabled={tagsLoading || subtagsLoading || partnersLoading}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                >
                  <Filter size={14} />
                  Aplicar
                </button>
              </div>
            </div>
          </div>

          {/* Barra de Busca - abaixo do card de filtros */}
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Buscar por descrição do grupo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          </div>

            </div>
          }
        >
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner message="Carregando..." />
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Estado inicial */}
          {!loading && !error && expenses.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Layers className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Configure os filtros acima e clique em "Aplicar" para visualizar os grupos.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Gráficos */}
          {!loading && !error && expenses.length > 0 && (
            <div className={`space-y-4 ${showBackToTop ? 'pb-20' : ''}`}>
              <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
                {([
                  { id: 'expense', label: 'Despesas' },
                  { id: 'revenue', label: 'Receitas' },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setChartTab(t.id)
                      setSelectedChartTag(null)
                    }}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                      chartTab === t.id
                        ? 'border-color-primary text-color-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={limitSlices}
                  onChange={(e) => setLimitSlices(e.target.checked)}
                />
                Limitar a {MAX_SLICES} itens (agrupar o restante em "{OTHERS}")
              </label>
              {tagSlices.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  Nenhum item encontrado
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {renderChartCard('Por Tag', tagSlices, true)}
                  {renderChartCard(
                    selectedChartTag ? `Por Subtag — ${selectedChartTag}` : 'Por Subtag',
                    subtagSlices,
                    false,
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Nota: a subtag Banco&gt;Cartão é ignorada neste relatório, pois os itens de cartão têm mapeamento próprio.
              </p>
            </div>
          )}
        </CadastroListPageBody>
        {exportRunner.overlay}
      </CadastroListPageShell>

      {/* Barra Flutuante Back to Top */}
      {showBackToTop && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              onClick={scrollToTop}
              className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}
    </div>
  )
}

export default GrupoPage
