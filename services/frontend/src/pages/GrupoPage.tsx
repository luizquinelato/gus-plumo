import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  cadastroRowIconBtnCls,
} from '../components/CadastroListPageLayout'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import LoadingSpinner from '../components/LoadingSpinner'
import { Layers, Search, X, ChevronDown, ChevronRight, Landmark, CreditCard, Gift, Filter, Calendar, Info, TrendingUp, TrendingDown, Minus, BarChart3, ArrowUp, Users, FileText, Tag, Tags } from 'lucide-react'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { useExportRunner } from '../hooks/useExportRunner'
import { downloadExcel, excelDateStamp } from '../utils/excelExportClient'
import { downloadPdf } from '../utils/pdfExportClient'
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

interface GroupedExpenses {
  description: string
  items: ExpenseDetail[]
  totalAmount: number
  count: number
}

interface SubtagGroup {
  name: string
  items: ExpenseDetail[]
  totalAmount: number
  count: number
}

interface TagGroup {
  name: string
  subtags: SubtagGroup[]
  totalAmount: number
  count: number
}

type GroupMode = 'item' | 'tag'

const NO_TAG = '(Sem tag)'
const NO_SUBTAG = '(Sem subtag)'

interface GroupStats {
  description: string
  periodStart: Date
  periodEnd: Date
  periodDays: number
  totalAmount: number
  count: number
  avgAmount: number
  avgIntervalDays: number
  trend: 'up' | 'down' | 'stable'
  trendPercentage: number
  maxAmount: number
  minAmount: number
  stdDeviation: number
  frequencyPerMonth: number
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
  const [groupMode, setGroupMode] = useState<GroupMode>('item')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [tags, setTags] = useState<Array<{ id: number; name: string }>>([])
  const [subtags, setSubtags] = useState<Array<{ id: number; name: string; tag_id: number; tag_name: string }>>([])

  useEffect(() => {
    axios
      .get('/api/reports/tags')
      .then((response) => setTags(response.data))
      .catch((err) => console.error('Erro ao carregar tags:', err))
    axios
      .get('/api/reports/subtags')
      .then((response) => setSubtags(response.data))
      .catch((err) => console.error('Erro ao carregar subtags:', err))
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
      .map((st) => ({ id: st.id, name: st.name, groupKey: st.tag_name, groupName: st.tag_name }))
  }, [subtags, selectedTagIds])

  useEffect(() => {
    axios
      .get('/api/expense-sharing/')
      .then((response) => setPartners(response.data))
      .catch((err) => console.error('Erro ao carregar parceiros:', err))
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

  // Estados de expansão
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Estado para modal de estatísticas do grupo
  const [groupStatsModal, setGroupStatsModal] = useState<{
    isOpen: boolean
    stats: GroupStats | null
  }>({
    isOpen: false,
    stats: null
  })

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // ESC para fechar modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (groupStatsModal.isOpen) {
          setGroupStatsModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [groupStatsModal.isOpen])

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

  // Formata data/hora
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Formata apenas data
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  // Calcula estatísticas do grupo
  const calculateGroupStats = (group: GroupedExpenses): GroupStats => {
    const items = group.items
    const amounts = items.map(i => Number(i.amount) || 0)
    const dates = items.map(i => new Date(i.date)).sort((a, b) => a.getTime() - b.getTime())

    // Período
    const periodStart = dates[0]
    const periodEnd = dates[dates.length - 1]
    const periodDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)))

    // Valores
    const totalAmount = amounts.reduce((sum, a) => sum + a, 0)
    const avgAmount = totalAmount / items.length
    const maxAmount = Math.max(...amounts)
    const minAmount = Math.min(...amounts)

    // Desvio padrão
    const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length
    const stdDeviation = Math.sqrt(variance)

    // Intervalo médio entre itens (em dias)
    let avgIntervalDays = 0
    if (dates.length > 1) {
      const intervals: number[] = []
      for (let i = 1; i < dates.length; i++) {
        const diffDays = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
        intervals.push(diffDays)
      }
      avgIntervalDays = intervals.reduce((sum, d) => sum + d, 0) / intervals.length
    }

    // Frequência por mês
    const frequencyPerMonth = periodDays > 0 ? (items.length / periodDays) * 30 : items.length

    // Tendência: compara média da primeira metade com a segunda metade
    let trend: 'up' | 'down' | 'stable' = 'stable'
    let trendPercentage = 0
    if (items.length >= 4) {
      const sortedByDate = [...items].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const midPoint = Math.floor(sortedByDate.length / 2)
      const firstHalf = sortedByDate.slice(0, midPoint)
      const secondHalf = sortedByDate.slice(midPoint)

      const avgFirst = firstHalf.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) / firstHalf.length
      const avgSecond = secondHalf.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) / secondHalf.length

      if (avgFirst !== 0) {
        trendPercentage = ((avgSecond - avgFirst) / Math.abs(avgFirst)) * 100
        if (trendPercentage > 10) trend = 'up'
        else if (trendPercentage < -10) trend = 'down'
      }
    }

    return {
      description: group.description,
      periodStart,
      periodEnd,
      periodDays,
      totalAmount,
      count: items.length,
      avgAmount,
      avgIntervalDays,
      trend,
      trendPercentage,
      maxAmount,
      minAmount,
      stdDeviation,
      frequencyPerMonth
    }
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
      } else if (selectedSources.length === 1) {
        const sourceMap: Record<string, string> = { bank: 'bank', card: 'cards', benefit: 'benefit' }
        params.append('source', sourceMap[selectedSources[0]])
      } else {
        // 2 fontes selecionadas
        params.append('sources', selectedSources.join(','))
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

  // Agrupa por descrição
  const groupedExpenses: GroupedExpenses[] = (() => {
    // Filtra por termo de busca
    const filtered = expenses.filter(exp => 
      !searchTerm || exp.description.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Agrupa por descrição
    const grouped = filtered.reduce((acc, exp) => {
      const desc = exp.description
      if (!acc[desc]) {
        acc[desc] = { description: desc, items: [], totalAmount: 0, count: 0 }
      }
      acc[desc].items.push(exp)
      acc[desc].totalAmount += Number(exp.amount) || 0
      acc[desc].count++
      return acc
    }, {} as Record<string, GroupedExpenses>)

    // Filtra apenas grupos com 2+ items e ordena por quantidade
    return Object.values(grouped)
      .filter(g => g.count >= 2)
      .sort((a, b) => b.count - a.count)
  })()

  // Agrupa por tag e, dentro dela, por subtag (com totais em cada nível)
  const tagGroups: TagGroup[] = useMemo(() => {
    const term = searchTerm.toLowerCase()
    const byTag = new Map<string, TagGroup>()
    expenses
      .filter((exp) => !term || exp.description.toLowerCase().includes(term))
      .forEach((exp) => {
        const tagName = exp.tag_name || NO_TAG
        const subName = exp.subtag_name || NO_SUBTAG
        const amount = Number(exp.amount) || 0
        let tag = byTag.get(tagName)
        if (!tag) {
          tag = { name: tagName, subtags: [], totalAmount: 0, count: 0 }
          byTag.set(tagName, tag)
        }
        let sub = tag.subtags.find((s) => s.name === subName)
        if (!sub) {
          sub = { name: subName, items: [], totalAmount: 0, count: 0 }
          tag.subtags.push(sub)
        }
        sub.items.push(exp)
        sub.totalAmount += amount
        sub.count++
        tag.totalAmount += amount
        tag.count++
      })
    const byAbs = (a: { totalAmount: number }, b: { totalAmount: number }) =>
      Math.abs(b.totalAmount) - Math.abs(a.totalAmount)
    const result = Array.from(byTag.values()).sort(byAbs)
    result.forEach((t) => t.subtags.sort(byAbs))
    return result
  }, [expenses, searchTerm])

  const tagKey = (tag: TagGroup) => `tag:${tag.name}`
  const subtagKey = (tag: TagGroup, sub: SubtagGroup) => `sub:${tag.name}|${sub.name}`

  const hasResults = groupMode === 'tag' ? tagGroups.length > 0 : groupedExpenses.length > 0

  // Toggle expansão
  const toggleGroup = (description: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(description)) {
      newExpanded.delete(description)
    } else {
      newExpanded.add(description)
    }
    setExpandedGroups(newExpanded)
  }

  const expandAll = () =>
    setExpandedGroups(
      new Set(
        groupMode === 'tag'
          ? tagGroups.flatMap((t) => [tagKey(t), ...t.subtags.map((s) => subtagKey(t, s))])
          : groupedExpenses.map((g) => g.description),
      ),
    )
  const collapseAll = () => setExpandedGroups(new Set())

  const clearFilters = () => {
    setSelectedSources([]) // Vazio = busca todas as fontes
    setStartDate(null)
    setEndDate(null)
    setSearchTerm('')
    setSelectedPartnerIds([])
    setSelectedTagIds([])
    setSelectedSubtagIds([])
  }

  const SOURCE_LABELS: Record<string, string> = { bank: 'Extrato', card: 'Fatura', benefit: 'Benefício' }

  const exportDate = (value: string) => {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR')
  }

  const exportInstallment = (item: ExpenseDetail) =>
    item.current_installment && item.total_installments
      ? `${item.current_installment}/${item.total_installments}`
      : ''

  const handleExportExcel = () => {
    if (!hasResults) return
    if (groupMode === 'tag') {
      void exportRunner.run('Gerando Excel…', () => {
        const rows: Array<Record<string, string | number>> = []
        tagGroups.forEach((tag) => {
          tag.subtags.forEach((sub) => {
            sub.items.forEach((item) => {
              rows.push({
                Tag: tag.name,
                Subtag: sub.name,
                Data: exportDate(item.date),
                Fonte: SOURCE_LABELS[item.source] ?? item.source,
                Descrição: item.description,
                Compartilhamento: item.shared_partner_name ?? '',
                Valor: Number(item.amount) || 0,
              })
            })
            rows.push({ Tag: tag.name, Subtag: `Total ${sub.name}`, Valor: sub.totalAmount })
          })
          rows.push({ Tag: `Total ${tag.name}`, Valor: tag.totalAmount })
        })
        return downloadExcel(`relatorio_grupos_tag_${excelDateStamp()}.xlsx`, [
          {
            name: 'Tags',
            rows,
            columns: ['Tag', 'Subtag', 'Data', 'Fonte', 'Descrição', 'Compartilhamento', 'Valor'],
            kinds: { Valor: 'money' },
          },
        ])
      })
      return
    }
    void exportRunner.run('Gerando Excel…', () => {
      const rows = groupedExpenses.flatMap((group) =>
        group.items.map((item) => ({
          Grupo: group.description,
          Data: exportDate(item.date),
          Fonte: SOURCE_LABELS[item.source] ?? item.source,
          Cartão: item.card_name ?? '',
          Parcela: exportInstallment(item),
          Compartilhamento: item.shared_partner_name ?? '',
          'Minha parte (%)': item.ownership_percentage ?? '',
          Valor: Number(item.amount) || 0,
        })),
      )
      return downloadExcel(`relatorio_grupos_${excelDateStamp()}.xlsx`, [
        {
          name: 'Grupos',
          rows,
          columns: ['Grupo', 'Data', 'Fonte', 'Cartão', 'Parcela', 'Compartilhamento', 'Minha parte (%)', 'Valor'],
          kinds: { Parcela: 'text', 'Minha parte (%)': 'decimal', Valor: 'money' },
        },
      ])
    })
  }

  const handleExportPdf = () => {
    if (!hasResults) return
    if (groupMode === 'tag') {
      void exportRunner.run('Gerando PDF…', () => {
        const rows: string[][] = []
        tagGroups.forEach((tag) => {
          rows.push([tag.name, '', '', '', formatCurrency(tag.totalAmount)])
          tag.subtags.forEach((sub) => {
            rows.push([`    ${sub.name}`, '', '', '', formatCurrency(sub.totalAmount)])
            sub.items.forEach((item) => {
              rows.push([
                `        ${item.description}`,
                exportDate(item.date),
                SOURCE_LABELS[item.source] ?? item.source,
                item.shared_partner_name ?? '',
                formatCurrency(Number(item.amount) || 0),
              ])
            })
          })
        })
        const total = tagGroups.reduce((sum, t) => sum + t.totalAmount, 0)
        return downloadPdf(`relatorio_grupos_tag_${excelDateStamp()}.pdf`, {
          title: 'Relatório por Tag/Subtag',
          subtitle: `${tagGroups.length} tags`,
          columns: [
            { header: 'Tag / Subtag / Descrição' },
            { header: 'Data', width_mm: 24 },
            { header: 'Fonte', width_mm: 24 },
            { header: 'Compartilhamento', width_mm: 36 },
            { header: 'Valor', width_mm: 28, align: 'right' },
          ],
          rows,
          footer: ['Total', '', '', '', formatCurrency(total)],
        })
      })
      return
    }
    if (groupedExpenses.length === 0) return
    void exportRunner.run('Gerando PDF…', () => {
      const rows = groupedExpenses.flatMap((group) =>
        group.items.map((item) => [
          group.description,
          exportDate(item.date),
          SOURCE_LABELS[item.source] ?? item.source,
          item.shared_partner_name ?? '',
          formatCurrency(Number(item.amount) || 0),
        ]),
      )
      const total = groupedExpenses.reduce((sum, g) => sum + g.totalAmount, 0)
      return downloadPdf(`relatorio_grupos_${excelDateStamp()}.pdf`, {
        title: 'Relatório por Grupo',
        subtitle: `${groupedExpenses.length} grupos`,
        columns: [
          { header: 'Grupo' },
          { header: 'Data', width_mm: 24 },
          { header: 'Fonte', width_mm: 24 },
          { header: 'Compartilhamento', width_mm: 36 },
          { header: 'Valor', width_mm: 28, align: 'right' },
        ],
        rows,
        footer: ['Total', '', '', '', formatCurrency(total)],
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
              subtitle="Transações agrupadas por descrição (apenas grupos com 2+ itens)"
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
                    placeholder={selectedTagIds.filter((id) => id !== -1).length === 0 ? 'Selecione uma tag primeiro' : 'Selecione...'}
                    groupByKey={selectedTagIds.filter((id) => id !== -1).length > 1}
                    disabled={selectedTagIds.filter((id) => id !== -1).length === 0}
                    icon={<Tags size={14} className="text-gray-500" />}
                  />
                </div>
              </div>
            </div>

            {/* Linha 2: Datas + Agrupar por + Botão Aplicar */}
            <div className="mt-3 flex items-end gap-3">
              <div className="w-40">
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
              <div className="w-40">
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
              <div className="flex-1 flex flex-wrap items-center gap-4 pb-1.5 pl-4">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Agrupar por:</span>
              {([
                { id: 'item', label: 'Item (descrição)' },
                { id: 'tag', label: 'Tag / Subtag' },
              ] as const).map((opt) => (
                <label key={opt.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="groupMode"
                    value={opt.id}
                    checked={groupMode === opt.id}
                    onChange={() => {
                      setGroupMode(opt.id)
                      setExpandedGroups(new Set())
                    }}
                  />
                  {opt.label}
                </label>
              ))}
              </div>
              <div className="flex items-end flex-shrink-0">
                <button
                  onClick={loadData}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
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

          {/* Controles de Expansão */}
          <div className="flex items-center justify-end gap-3 mt-4">
            <button
              onClick={expandAll}
              className="px-3 py-2 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Expandir Tudo
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-2 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Recolher Tudo
            </button>
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

          {/* Grupos por Tag / Subtag */}
          {!loading && !error && expenses.length > 0 && groupMode === 'tag' && (
            <div className={`space-y-2 ${showBackToTop ? 'pb-20' : ''}`}>
              {tagGroups.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  Nenhum item encontrado
                </div>
              ) : (
                tagGroups.map((tag) => {
                  const tagOpen = expandedGroups.has(tagKey(tag))
                  return (
                    <div
                      key={tagKey(tag)}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                    >
                      <div
                        className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                        onClick={() => toggleGroup(tagKey(tag))}
                      >
                        <span className="mr-3 text-gray-500 dark:text-gray-400">
                          {tagOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        </span>
                        <div className="p-2 rounded-lg mr-3 bg-color-primary-light">
                          <Tag size={20} className="text-color-primary" />
                        </div>
                        <div className="flex-1 font-semibold text-gray-900 dark:text-white">{tag.name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 mr-4">
                          <span className="font-medium">{tag.count}</span> {tag.count === 1 ? 'item' : 'itens'}
                        </div>
                        <div className={`text-lg font-bold ${tag.totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          {formatCurrency(tag.totalAmount)}
                        </div>
                      </div>

                      {tagOpen && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                          {tag.subtags.map((sub) => {
                            const subOpen = expandedGroups.has(subtagKey(tag, sub))
                            return (
                              <div key={subtagKey(tag, sub)} className="border-b last:border-b-0 border-gray-200 dark:border-gray-700">
                                <div
                                  className="flex items-center py-3 pl-10 pr-4 hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer"
                                  onClick={() => toggleGroup(subtagKey(tag, sub))}
                                >
                                  <span className="mr-2 text-gray-500 dark:text-gray-400">
                                    {subOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </span>
                                  <Tags size={16} className="mr-2 text-color-primary" />
                                  <div className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">{sub.name}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mr-4">
                                    {sub.count} {sub.count === 1 ? 'item' : 'itens'}
                                  </div>
                                  <div className={`text-sm font-bold ${sub.totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {formatCurrency(sub.totalAmount)}
                                  </div>
                                </div>

                                {subOpen && (
                                  <div>
                                    {[...sub.items]
                                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                      .map((item) => (
                                        <div
                                          key={`${item.source}-${item.id}`}
                                          className="grid grid-cols-[50px_1fr_2fr_1fr_100px] gap-2 py-2 pl-16 pr-4 border-t border-gray-200 dark:border-gray-700 text-sm items-center"
                                        >
                                          <div className="flex items-center">
                                            {item.source === 'bank' && <Landmark size={16} style={{ color: 'var(--color-1)' }} />}
                                            {item.source === 'card' && <CreditCard size={16} style={{ color: 'var(--color-2)' }} />}
                                            {item.source === 'benefit' && <Gift size={16} style={{ color: 'var(--color-3)' }} />}
                                          </div>
                                          <span className="text-xs text-gray-700 dark:text-gray-300">{formatDateTime(item.date)}</span>
                                          <span className="text-gray-800 dark:text-gray-200 truncate" title={item.description}>{item.description}</span>
                                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.shared_partner_name || ''}</span>
                                          <span className={`text-right font-semibold ${item.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                            {formatCurrency(item.amount)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* Grupos */}
          {!loading && !error && expenses.length > 0 && groupMode === 'item' && (
            <div className={`space-y-2 ${showBackToTop ? 'pb-20' : ''}`}>
              {groupedExpenses.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  Nenhum grupo encontrado com 2+ itens
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Encontrados <span className="font-semibold text-gray-900 dark:text-white">{groupedExpenses.length}</span> grupos
                  </div>
                  {groupedExpenses.map((group) => {
                    const isExpanded = expandedGroups.has(group.description)
                    const isNegative = group.totalAmount < 0

                    return (
                      <div
                        key={group.description}
                        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                      >
                        {/* Header do Grupo */}
                        <div
                          className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                          onClick={() => toggleGroup(group.description)}
                        >
                          {/* Botão expansão */}
                          <button className="mr-3 text-gray-500 dark:text-gray-400">
                            {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                          </button>

                          {/* Ícone tipo */}
                          <div className="p-2 rounded-lg mr-3 bg-color-primary-light">
                            <Layers size={20} className="text-color-primary" />
                          </div>

                          {/* Descrição */}
                          <div className="flex-1">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {group.description}
                            </span>
                          </div>

                          {/* Contador */}
                          <div className="text-sm text-gray-500 dark:text-gray-400 mr-4">
                            <span className="font-medium">{group.count}</span> {group.count === 1 ? 'item' : 'itens'}
                          </div>

                          {/* Total */}
                          <div className={`text-lg font-bold ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {formatCurrency(group.totalAmount)}
                          </div>

                          {/* Botão Info */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const stats = calculateGroupStats(group)
                              setGroupStatsModal({ isOpen: true, stats })
                            }}
                            className={`${cadastroRowIconBtnCls} ml-2`}
                            title="Ver estatísticas do grupo"
                          >
                            <Info size={18} />
                          </button>
                        </div>

                        {/* Items expandidos */}
                        {isExpanded && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                            {/* Cabeçalho */}
                            <div className="grid grid-cols-[40px_50px_1fr_1.5fr_1fr_1fr_1fr_100px] gap-2 p-2.5 px-4 bg-gray-50 dark:bg-gray-700/50">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">#</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Origem</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Data/Hora</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Conta/Cartão</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Tag/Subtag</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Compartilhamento</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider text-right">Valor</span>
                            </div>

                            {/* Linhas */}
                            <div>
                              {group.items
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .map((item, index) => (
                                <div
                                  key={`${item.source}-${item.id}`}
                                  className="grid grid-cols-[40px_50px_1fr_1.5fr_1fr_1fr_1fr_100px] gap-2 p-2.5 px-4 border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm items-center"
                                  onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                                >
                                  {/* Número */}
                                  <span className="font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>

                                  {/* Origem (ícone + manual se aplicável) */}
                                  <div className="flex items-center gap-1">
                                    {item.source === 'bank' && <Landmark size={16} style={{ color: 'var(--color-1)' }} />}
                                    {item.source === 'card' && <CreditCard size={16} style={{ color: 'var(--color-2)' }} />}
                                    {item.source === 'benefit' && <Gift size={16} style={{ color: 'var(--color-3)' }} />}
                                    {/* Mostra "M" apenas para bank_statements manuais (sem category) */}
                                    {item.source === 'bank' && item.category === null && (
                                      <span
                                        className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-orange-500 text-white shadow-sm"
                                        title="Lançamento Manual"
                                      >
                                        M
                                      </span>
                                    )}
                                  </div>

                                  {/* Data/Hora */}
                                  <span className="text-gray-700 dark:text-gray-300 text-xs">
                                    {formatDateTime(item.date)}
                                  </span>

                                  {/* Conta/Cartão */}
                                  <div className="text-gray-600 dark:text-gray-400 text-xs truncate">
                                    {item.source === 'card' || item.source === 'benefit' ? (
                                      <>
                                        {item.card_name || '-'}
                                        {item.card_number && <span className="text-gray-400"> • ***{item.card_number.slice(-4)}</span>}
                                      </>
                                    ) : (
                                      item.account_name || '-'
                                    )}
                                  </div>

                                  {/* Tag/Subtag */}
                                  <div className="text-gray-700 dark:text-gray-300 text-xs truncate">
                                    {item.tag_name || '-'}
                                    {item.subtag_name && <span className="text-gray-400"> / {item.subtag_name}</span>}
                                  </div>

                                  {/* Compartilhamento */}
                                  <div className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                    <SharedAccountDisplay
                                      account={item.shared_partner_name ? {
                                        id: item.shared_partner_id || 0,
                                        name: item.shared_partner_name,
                                        bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
                                        agency: item.shared_partner_agency,
                                        account_number: item.shared_partner_account_number
                                      } : null}
                                      ownershipPercentage={item.ownership_percentage}
                                    />
                                  </div>

                                  {/* Valor */}
                                  <div className="text-right">
                                    <span className={`font-semibold ${item.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                      {formatCurrency(item.amount)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </CadastroListPageBody>
        {exportRunner.overlay}
      </CadastroListPageShell>

      {groupStatsModal.isOpen && groupStatsModal.stats && (
        <CadastroModalShell
          maxWidth="max-w-lg"
          zClass="z-[60]"
          onBackdropClick={() => setGroupStatsModal({ isOpen: false, stats: null })}
        >
          <CadastroModalHeader
            isEdit={false}
            title="Estatísticas do Grupo"
            onClose={() => setGroupStatsModal({ isOpen: false, stats: null })}
            icon={<BarChart3 size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Identificação" icon={<Layers size={14} />}>
              <p
                className="truncate text-sm font-medium text-gray-800 dark:text-gray-100"
                title={groupStatsModal.stats.description}
              >
                {groupStatsModal.stats.description}
              </p>
            </CadastroFormSection>

            <CadastroFormSection title="Período" icon={<Calendar size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={3}>
                  <div className="min-w-0">
                    <CadastroFieldLabel>De</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm font-medium text-gray-800 dark:text-gray-100">
                      {formatDate(groupStatsModal.stats.periodStart)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Até</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm font-medium text-gray-800 dark:text-gray-100">
                      {formatDate(groupStatsModal.stats.periodEnd)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Duração</CadastroFieldLabel>
                    <p className="mt-0.5 text-sm font-medium text-gray-800 dark:text-gray-100">
                      {groupStatsModal.stats.periodDays} dias
                    </p>
                  </div>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Valores" icon={<BarChart3 size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Total</CadastroFieldLabel>
                    <p className={`mt-0.5 text-lg font-bold ${groupStatsModal.stats.totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrency(groupStatsModal.stats.totalAmount)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Média por Item</CadastroFieldLabel>
                    <p className={`mt-0.5 text-lg font-bold ${groupStatsModal.stats.avgAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrency(groupStatsModal.stats.avgAmount)}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Menor Valor</CadastroFieldLabel>
                    <p className={`mt-0.5 font-semibold ${groupStatsModal.stats.minAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrency(groupStatsModal.stats.minAmount)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Maior Valor</CadastroFieldLabel>
                    <p className={`mt-0.5 font-semibold ${groupStatsModal.stats.maxAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrency(groupStatsModal.stats.maxAmount)}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Frequência</CadastroFieldLabel>
                    <p className="mt-0.5 font-semibold text-gray-800 dark:text-gray-100">
                      {groupStatsModal.stats.frequencyPerMonth.toFixed(1)}x{' '}
                      <span className="text-sm font-normal text-gray-500">por mês</span>
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Intervalo Médio</CadastroFieldLabel>
                    <p className="mt-0.5 font-semibold text-gray-800 dark:text-gray-100">
                      {groupStatsModal.stats.avgIntervalDays.toFixed(1)}{' '}
                      <span className="text-sm font-normal text-gray-500">dias</span>
                    </p>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <div className="min-w-0">
                    <CadastroFieldLabel>Desvio Padrão</CadastroFieldLabel>
                    <p className="mt-0.5 font-semibold text-gray-800 dark:text-gray-100">
                      {formatCurrency(Math.abs(groupStatsModal.stats.stdDeviation))}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {groupStatsModal.stats.stdDeviation < Math.abs(groupStatsModal.stats.avgAmount) * 0.3
                        ? '✓ Valores consistentes'
                        : '⚠ Alta variação nos valores'}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Tendência" icon={<TrendingUp size={14} />}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {groupStatsModal.stats.trend === 'up' && (
                    <>
                      <TrendingUp size={20} className="text-red-500" />
                      <span className="font-semibold text-red-600 dark:text-red-400">Crescimento</span>
                    </>
                  )}
                  {groupStatsModal.stats.trend === 'down' && (
                    <>
                      <TrendingDown size={20} className="text-green-500" />
                      <span className="font-semibold text-green-600 dark:text-green-400">Declínio</span>
                    </>
                  )}
                  {groupStatsModal.stats.trend === 'stable' && (
                    <>
                      <Minus size={20} className="text-gray-500" />
                      <span className="font-semibold text-gray-600 dark:text-gray-400">Estável</span>
                    </>
                  )}
                </div>
                <div className="text-right">
                  <span className={`text-xl font-bold ${
                    groupStatsModal.stats.trend === 'up' ? 'text-red-600 dark:text-red-400' :
                    groupStatsModal.stats.trend === 'down' ? 'text-green-600 dark:text-green-400' :
                    'text-gray-600 dark:text-gray-400'
                  }`}>
                    {groupStatsModal.stats.trendPercentage > 0 ? '+' : ''}{groupStatsModal.stats.trendPercentage.toFixed(1)}%
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">variação média</p>
                </div>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setGroupStatsModal({ isOpen: false, stats: null })}
            hideSave
            closeLabel="Fechar"
          />
        </CadastroModalShell>
      )}

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
