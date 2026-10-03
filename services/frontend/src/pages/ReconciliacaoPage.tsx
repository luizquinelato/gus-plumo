import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroFilterField,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageFilterCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageSearchField,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroFilterFieldCls,
  listPageTableRowHoverCls,
  listPageTableSectionCls,
  listPageTableTdCls,
} from '../components/CadastroListPageLayout'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import { ListPageTable } from '../components/ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import FloatingFooterBar from '../components/FloatingFooterBar'
import PageScrollRoot from '../components/PageScrollRoot'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import ConfirmDialog from '../components/ConfirmDialog'
import Toast from '../components/Toast'
import { InvoiceReconcilePickPanel } from '../components/InvoiceReconcilePickPanel'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  flattenReconcileCycles,
  type InvoiceMatchCandidate,
  type InvoiceMatchCycle,
  type InvoiceMatchHistory,
  type InvoiceSuggestHistoryResponse,
} from '../types/invoiceReconcile'
import {
  ArrowUp,
  Calendar,
  CheckCircle2,
  Filter,
  Link2,
  Loader2,
  Save,
  Unlink,
  X,
} from 'lucide-react'

type ReconcileTab = 'pending' | 'matched' | 'unlinked'

type ReconcileDraftLink = {
  candidate: InvoiceMatchCandidate
  match_method: 'auto' | 'manual'
}

const DESKTOP_INSPECTOR_MQ = '(min-width: 1024px)'

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '—'
  const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  return date.toLocaleDateString('pt-BR')
}

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

const parseYearMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  return {
    year: year || null,
    month: month >= 1 && month <= 12 ? month : null,
    monthLabel: month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : yearMonth,
  }
}

const formatCycleMonthColumn = (yearMonth: string) => {
  const period = parseYearMonth(yearMonth)
  if (!period.year || !period.month) return yearMonth
  return `${String(period.month).padStart(2, '0')}/${period.year}`
}

const formatCalendarDatesFromCycle = (
  cycle: InvoiceMatchCycle,
  kind: 'closing' | 'due',
) => {
  const dateKey = kind === 'closing' ? 'invoice_closing_dates' : 'invoice_due_dates'
  const singleKey = kind === 'closing' ? 'invoice_closing_date' : 'invoice_due_date'
  const dayKey = kind === 'closing' ? 'closing_day' : 'due_day'

  const dates = cycle[dateKey]?.length
    ? cycle[dateKey]!
    : cycle[singleKey]
      ? [cycle[singleKey]!]
      : []
  if (dates.length === 0) {
    const fallbackDays = [...new Set(cycle.cards.map((card) => card[dayKey] ?? 14))]
    const [ymYear, ymMonth] = cycle.year_month.split('-').map(Number)
    if (!ymYear || !ymMonth) return '—'
    const lastDay = new Date(ymYear, ymMonth, 0).getDate()
    return fallbackDays
      .sort((left, right) => left - right)
      .map((day) => {
        const clamped = Math.min(Math.max(day, 1), lastDay)
        return formatDate(`${ymYear}-${String(ymMonth).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`)
      })
      .join(' · ')
  }
  return dates.map((value) => formatDate(value)).join(' · ')
}

const statusMeta = (status: InvoiceMatchCycle['status']) => {
  if (status === 'matched') return { tone: 'success' as const, label: 'Vinculado' }
  if (status === 'unlinked') return { tone: 'info' as const, label: 'Não vinculado' }
  return { tone: 'neutral' as const, label: 'Pendente' }
}

const isPendingCycle = (cycle: InvoiceMatchCycle) =>
  cycle.status === 'unmatched' || cycle.status === 'ambiguous'

const isMatchedCycle = (cycle: InvoiceMatchCycle) =>
  cycle.status === 'matched' && cycle.match != null

const cycleMatchesQuery = (cycle: InvoiceMatchCycle, raw: string) => {
  if (!raw.trim()) return true
  const q = raw.trim().toLowerCase()
  const period = parseYearMonth(cycle.year_month)
  const parts = [
    cycle.name,
    cycle.group_name,
    cycle.year_month,
    period.year?.toString(),
    period.monthLabel,
    cycle.statement_description,
    cycle.match?.description,
    cycle.amount_to_pay.toString(),
    ...(cycle.card_names ?? []),
    ...cycle.cards.map((card) => `${card.name} ${card.number}`),
  ]
  return parts.some((part) => (part ?? '').toLowerCase().includes(q))
}

const emptyCopyForTab = (tab: ReconcileTab) => {
  if (tab === 'pending') {
    return { title: 'Fila limpa', description: 'Não há ciclos pendentes neste recorte.' }
  }
  if (tab === 'matched') {
    return { title: 'Nenhum vínculo', description: 'Nenhum ciclo vinculado neste recorte.' }
  }
  return { title: 'Nenhum não vinculado', description: 'Nenhum ciclo marcado como sem débito no extrato.' }
}

const ReconciliacaoPage = () => {
  const currentYear = String(new Date().getFullYear())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [history, setHistory] = useState<InvoiceMatchHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<ReconcileTab>('pending')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [workingKey, setWorkingKey] = useState<string | null>(null)
  const [draftYear, setDraftYear] = useState('')
  const [appliedYear, setAppliedYear] = useState('')
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_INSPECTOR_MQ).matches,
  )
  const [toast, setToast] = useState<{
    show: boolean
    message: string
    type: 'success' | 'error' | 'warning'
    duration?: number
  }>({
    show: false,
    message: '',
    type: 'success',
  })
  const [draftLinks, setDraftLinks] = useState<Map<string, ReconcileDraftLink>>(new Map())
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const [suggestNotFoundKeys, setSuggestNotFoundKeys] = useState<Set<string>>(new Set())
  const [showUnmatchConfirm, setShowUnmatchConfirm] = useState(false)

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'warning',
    duration?: number,
  ) => {
    setToast({ show: true, message, type, duration })
  }

  const closeInspector = useCallback(() => {
    setSelectedKey(null)
  }, [])

  useEscapeKey(closeInspector, selectedKey != null)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_INSPECTOR_MQ)
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const clearDraftState = useCallback(() => {
    setDraftLinks(new Map())
    setSelectedRowKeys(new Set())
    setSuggestNotFoundKeys(new Set())
  }, [])

  const scopeCyclesByYear = (cycles: InvoiceMatchCycle[], yearFilter: string) => {
    if (!yearFilter) return cycles
    return cycles.filter((cycle) => cycle.year_month.startsWith(`${yearFilter}-`))
  }

  const applySuggestResponse = (response: InvoiceSuggestHistoryResponse, yearFilter: string) => {
    const cycles = flattenReconcileCycles(response.preview)
    const scopedPending = scopeCyclesByYear(cycles, yearFilter).filter(isPendingCycle)
    const suggestionByKey = new Map(
      (response.suggestions ?? []).map((item) => [item.key, item] as const),
    )
    const nextDrafts = new Map<string, ReconcileDraftLink>()
    const notFound = new Set<string>()
    for (const cycle of scopedPending) {
      const suggestion = suggestionByKey.get(cycle.key)
      if (suggestion) {
        nextDrafts.set(cycle.key, {
          candidate: suggestion.candidate,
          match_method: 'auto',
        })
      } else {
        notFound.add(cycle.key)
      }
    }
    setDraftLinks(nextDrafts)
    setSuggestNotFoundKeys(notFound)
    setSelectedRowKeys(new Set(nextDrafts.keys()))
    return {
      foundCount: nextDrafts.size,
      notFoundCount: notFound.size,
      skippedMultiple: response.skipped_multiple_count ?? 0,
    }
  }

  const loadHistoryWithSuggestions = async (yearFilter: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const response = await axios.post<InvoiceSuggestHistoryResponse>(
        '/api/invoice-payment-matches/suggest-history',
      )
      setHistory(response.data.preview)
      const stats = applySuggestResponse(response.data, yearFilter)
      if (!opts?.silent) {
        if (stats.foundCount > 0) {
          showToast(
            `${stats.foundCount} ${stats.foundCount === 1 ? 'vínculo sugerido' : 'vínculos sugeridos'}${
              stats.notFoundCount > 0 ? ` · ${stats.notFoundCount} sem match automático` : ''
            }. Revise e salve no rodapé.`,
            stats.notFoundCount > 0 || stats.skippedMultiple > 0 ? 'warning' : 'success',
            stats.notFoundCount > 0 ? 7000 : 4000,
          )
        } else if (stats.notFoundCount > 0) {
          showToast(
            stats.skippedMultiple > 0
              ? 'Nenhum vínculo único automático. Há ambiguidade no extrato — concilie manualmente.'
              : 'Nenhum débito único encontrado para os ciclos pendentes deste recorte.',
            'warning',
            6000,
          )
        }
      }
      return stats
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao carregar reconciliação', 'error')
      return null
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  const loadHistory = async (opts?: { silent?: boolean; keepDrafts?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const response = await axios.get<InvoiceMatchHistory>('/api/invoice-payment-matches/preview-history')
      setHistory(response.data)
      if (!opts?.keepDrafts) {
        clearDraftState()
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao carregar reconciliação', 'error')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const onScroll = () => setShowBackToTop(container.scrollTop > 300)
    onScroll()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [filtersApplied, loading, tab])

  const allCycles = useMemo(() => flattenReconcileCycles(history), [history])

  const yearOptions = useMemo(() => {
    const years = new Set<number>([Number(currentYear)])
    allCycles.forEach((cycle) => {
      const year = parseYearMonth(cycle.year_month).year
      if (year) years.add(year)
    })
    return [...years].sort((left, right) => right - left)
  }, [allCycles, currentYear])

  const scopedCycles = useMemo(() => {
    if (!appliedYear) return allCycles
    return allCycles.filter((cycle) => cycle.year_month.startsWith(`${appliedYear}-`))
  }, [allCycles, appliedYear])

  const counts = useMemo(() => ({
    pending: scopedCycles.filter(isPendingCycle).length,
    matched: scopedCycles.filter((cycle) => cycle.status === 'matched').length,
    unlinked: scopedCycles.filter((cycle) => cycle.status === 'unlinked').length,
  }), [scopedCycles])

  const filtered = useMemo(() => {
    return scopedCycles.filter((cycle) => {
      if (tab === 'pending' && !isPendingCycle(cycle)) return false
      if (tab === 'matched' && cycle.status !== 'matched') return false
      if (tab === 'unlinked' && cycle.status !== 'unlinked') return false
      return cycleMatchesQuery(cycle, search)
    })
  }, [scopedCycles, tab, search])

  const pendingFilteredKeys = useMemo(
    () => filtered.filter(isPendingCycle).map((cycle) => cycle.key),
    [filtered],
  )

  const matchedFilteredKeys = useMemo(
    () => filtered.filter(isMatchedCycle).map((cycle) => cycle.key),
    [filtered],
  )

  const selectableRowKeys = useMemo(() => {
    if (tab === 'pending') return pendingFilteredKeys
    if (tab === 'matched') return matchedFilteredKeys
    return []
  }, [tab, pendingFilteredKeys, matchedFilteredKeys])

  const rowSelectAllState = useMemo(() => {
    if (selectableRowKeys.length === 0) return 'none' as const
    const selectedCount = selectableRowKeys.filter((key) => selectedRowKeys.has(key)).length
    if (selectedCount === 0) return 'none' as const
    if (selectedCount === selectableRowKeys.length) return 'all' as const
    return 'partial' as const
  }, [selectableRowKeys, selectedRowKeys])

  useEffect(() => {
    setSelectedRowKeys(new Set())
  }, [tab])

  const sortedRows = useMemo(
    () =>
      [...filtered].sort((left, right) => {
        const byMonth = right.year_month.localeCompare(left.year_month)
        if (byMonth !== 0) return byMonth
        const byDate = (right.invoice_due_date ?? '').localeCompare(left.invoice_due_date ?? '')
        if (byDate !== 0) return byDate
        return left.name.localeCompare(right.name, 'pt-BR')
      }),
    [filtered],
  )

  const selected = allCycles.find((cycle) => cycle.key === selectedKey) ?? null
  const selectedDraft = selected ? draftLinks.get(selected.key) : undefined

  useEffect(() => {
    if (selectedKey && !allCycles.some((cycle) => cycle.key === selectedKey)) {
      setSelectedKey(null)
    }
  }, [allCycles, selectedKey])

  const stageDraftLink = (
    cycle: InvoiceMatchCycle,
    candidate: InvoiceMatchCandidate,
    matchMethod: 'auto' | 'manual',
  ) => {
    setDraftLinks((prev) => {
      const next = new Map(prev)
      next.set(cycle.key, { candidate, match_method: matchMethod })
      return next
    })
    setSelectedRowKeys((prev) => new Set(prev).add(cycle.key))
    setSuggestNotFoundKeys((prev) => {
      const next = new Set(prev)
      next.delete(cycle.key)
      return next
    })
    showToast('Vínculo preparado. Use Salvar vínculos no rodapé para gravar.', 'success', 4000)
  }

  const unmatch = async (cycle: InvoiceMatchCycle) => {
    if (!cycle.match) return
    setWorkingKey(cycle.key)
    try {
      await axios.delete(`/api/invoice-payment-matches/${cycle.match.id}`)
      showToast(cycle.status === 'unlinked' ? 'Marca de não vinculado removida' : 'Vínculo desfeito', 'success')
      setDraftLinks((prev) => {
        const next = new Map(prev)
        next.delete(cycle.key)
        return next
      })
      await loadHistory({ silent: true, keepDrafts: true })
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao desfazer', 'error')
    } finally {
      setWorkingKey(null)
    }
  }

  const skipMatch = async (cycle: InvoiceMatchCycle) => {
    setWorkingKey(cycle.key)
    try {
      await axios.post('/api/invoice-payment-matches/skip', {
        year_month: cycle.year_month,
        invoice_group_id: cycle.invoice_group_id,
        credit_card_id: cycle.credit_card_id,
      })
      showToast('Marcado como não vinculado', 'success')
      setDraftLinks((prev) => {
        const next = new Map(prev)
        next.delete(cycle.key)
        return next
      })
      await loadHistory({ silent: true })
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao marcar como não vinculado', 'error')
    } finally {
      setWorkingKey(null)
    }
  }

  const saveSelectedDrafts = async () => {
    const keysToSave = [...selectedRowKeys].filter((key) => draftLinks.has(key))
    if (keysToSave.length === 0) {
      showToast('Selecione ciclos com vínculo preparado para salvar', 'warning')
      return
    }
    setWorkingKey('save-drafts')
    let saved = 0
    let failed = 0
    try {
      for (const key of keysToSave) {
        const draft = draftLinks.get(key)
        const cycle = allCycles.find((item) => item.key === key)
        if (!draft || !cycle) continue
        try {
          await axios.post('/api/invoice-payment-matches/', {
            year_month: cycle.year_month,
            bank_statement_id: draft.candidate.bank_statement_id,
            invoice_group_id: cycle.invoice_group_id,
            credit_card_id: cycle.credit_card_id,
            match_method: draft.match_method,
          })
          saved += 1
        } catch {
          failed += 1
        }
      }
      if (saved > 0) {
        showToast(
          `${saved} ${saved === 1 ? 'vínculo salvo' : 'vínculos salvos'}${failed > 0 ? `. ${failed} falhou(aram).` : ''}`,
          failed > 0 ? 'warning' : 'success',
        )
      } else {
        showToast('Não foi possível salvar os vínculos selecionados', 'error')
      }
      if (filtersApplied) {
        await loadHistoryWithSuggestions(appliedYear, { silent: true })
      } else {
        await loadHistory({ silent: true })
      }
    } finally {
      setWorkingKey(null)
    }
  }

  const toggleRowSelect = (key: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleRowSelectAll = () => {
    if (rowSelectAllState === 'all') {
      setSelectedRowKeys(new Set())
      return
    }
    setSelectedRowKeys(new Set(selectableRowKeys))
  }

  const selectedMatchedForUnlink = useMemo(
    () =>
      [...selectedRowKeys]
        .map((key) => allCycles.find((cycle) => cycle.key === key))
        .filter((cycle): cycle is InvoiceMatchCycle => cycle != null && isMatchedCycle(cycle)),
    [allCycles, selectedRowKeys],
  )

  const unmatchSelected = async () => {
    const targets = selectedMatchedForUnlink
    if (targets.length === 0) {
      showToast('Selecione ciclos vinculados para desvincular', 'warning')
      return
    }
    setWorkingKey('unmatch-bulk')
    let removed = 0
    let failed = 0
    try {
      for (const cycle of targets) {
        if (!cycle.match) continue
        try {
          await axios.delete(`/api/invoice-payment-matches/${cycle.match.id}`)
          removed += 1
        } catch {
          failed += 1
        }
      }
      if (removed > 0) {
        showToast(
          `${removed} ${removed === 1 ? 'vínculo desfeito' : 'vínculos desfeitos'}${failed > 0 ? `. ${failed} falhou(aram).` : ''}`,
          failed > 0 ? 'warning' : 'success',
        )
      } else {
        showToast('Não foi possível desvincular os ciclos selecionados', 'error')
      }
      setSelectedRowKeys(new Set())
      await loadHistory({ silent: true, keepDrafts: true })
    } finally {
      setWorkingKey(null)
    }
  }

  const applyFilters = () => {
    setAppliedYear(draftYear)
    setFiltersApplied(true)
    setSelectedKey(null)
    clearDraftState()
    void loadHistoryWithSuggestions(draftYear)
  }

  const clearFilters = () => {
    setDraftYear('')
    setAppliedYear('')
    setFiltersApplied(false)
    setSearch('')
    setSelectedKey(null)
    clearDraftState()
  }

  const hasActiveFilters = filtersApplied || draftYear !== appliedYear
  const showQueue = filtersApplied && !loading
  const showDesktopInspector = Boolean(selected) && isDesktop
  const showMobileInspector = Boolean(selected) && !isDesktop
  const emptyTab = emptyCopyForTab(tab)
  const yearHint = appliedYear || 'Todos'

  const savableSelectedCount = [...selectedRowKeys].filter((key) => draftLinks.has(key)).length

  const bulkSelectTab = tab === 'pending' || tab === 'matched'
  const showPendingFooter = tab === 'pending' && filtersApplied
  const showMatchedFooter = tab === 'matched' && filtersApplied
  const selectedMatchedCount = selectedMatchedForUnlink.length
  const footerSaveVisible = showPendingFooter && savableSelectedCount > 0
  const footerUnmatchVisible = showMatchedFooter && selectedMatchedCount > 0
  const footerActionsVisible = footerSaveVisible || footerUnmatchVisible
  const footerVisible = footerActionsVisible || showBackToTop

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const renderCycleRow = (cycle: InvoiceMatchCycle, index: number) => {
    const meta = statusMeta(cycle.status)
    const selectedRow = selectedKey === cycle.key
    const draft = draftLinks.get(cycle.key)
    const pendingRow = isPendingCycle(cycle)
    const matchedRow = isMatchedCycle(cycle)
    const rowChecked = selectedRowKeys.has(cycle.key)
    const linkNotFound = suggestNotFoundKeys.has(cycle.key) && pendingRow && !draft
    return (
      <tr
        key={cycle.key}
        className={`${listPageTableRowHoverCls} cursor-pointer ${
          selectedRow
            ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]'
            : rowChecked && bulkSelectTab
              ? 'bg-[color-mix(in_srgb,var(--color-1)_6%,transparent)]'
              : draft
                ? 'bg-[color-mix(in_srgb,var(--color-save)_8%,transparent)]'
                : linkNotFound
                  ? 'bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)]'
                  : ''
        }`}
        onClick={() => setSelectedKey(selectedRow ? null : cycle.key)}
      >
        {bulkSelectTab ? (
          <ListTableCheckboxCell
            checked={rowChecked}
            disabled={tab === 'pending' ? !pendingRow : !matchedRow}
            onToggle={() => toggleRowSelect(cycle.key)}
            title={
              tab === 'pending' && !pendingRow
                ? 'Somente ciclos pendentes'
                : tab === 'matched' && !matchedRow
                  ? 'Somente ciclos vinculados'
                  : undefined
            }
          />
        ) : (
          <ListTableIndexCell index={index + 1} />
        )}
        {bulkSelectTab ? <ListTableIndexCell index={index + 1} /> : null}
        <ListTableSpacerCell />
        <td className={`${listPageTableTdCls} whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-200`}>
          {formatCycleMonthColumn(cycle.year_month)}
        </td>
        <td className={`${listPageTableTdCls} whitespace-nowrap tabular-nums text-xs text-gray-700 dark:text-gray-200`}>
          {formatCalendarDatesFromCycle(cycle, 'closing')}
        </td>
        <td className={`${listPageTableTdCls} whitespace-nowrap tabular-nums text-xs text-gray-700 dark:text-gray-200`}>
          {formatCalendarDatesFromCycle(cycle, 'due')}
        </td>
        <td className={listPageTableTdCls}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm font-semibold ${selectedRow ? 'text-[var(--color-1)]' : 'text-gray-800 dark:text-gray-100'}`}>
              {cycle.name}
            </span>
            {cycle.invoice_group_id != null && (
              <Badge
                variant={badgeVariantForColumnRole('classificationPrimary')}
                tone="brand4"
                label="Grupo"
                title="Fatura conjunta"
              />
            )}
          </div>
          {cycle.cards.length > 0 ? (
            <p className="mt-0.5 text-xs text-gray-500">
              {cycle.cards
                .map((card) => `${card.name}${card.active === false ? ' (inativo)' : ''}`)
                .join(' · ')}
            </p>
          ) : null}
        </td>
        <td className={`${listPageTableTdCls} font-semibold tabular-nums text-gray-800 dark:text-gray-100`}>
          {formatCurrency(cycle.amount_to_pay)}
        </td>
        <td className={listPageTableTdCls}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={badgeVariantForColumnRole('statusPrimary')}
              tone={meta.tone}
              label={meta.label}
            />
            {draft ? (
              <Badge variant="count" tone="brand3" label="A salvar" title="Vínculo preparado — use Salvar no rodapé" />
            ) : null}
            {linkNotFound ? (
              <Badge
                variant={badgeVariantForColumnRole('statusPrimary')}
                tone="warning"
                label={cycle.multiple_debits ? 'Ambíguo no extrato' : 'Sem match automático'}
                title="Nenhum débito único encontrado — abra o ciclo e concilie manualmente"
              />
            ) : null}
          </div>
        </td>
        <td className={listPageTableTdCls}>
          {draft ? (
            <span className="text-gray-800 dark:text-gray-100">
              {formatDate(draft.candidate.date)} · {draft.candidate.description || '—'}
            </span>
          ) : cycle.status === 'unlinked' ? (
            <span className="text-gray-400">—</span>
          ) : cycle.match ? (
            <span>
              {formatDate(cycle.match.date)} · {cycle.match.description || '—'}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      </tr>
    )
  }

  const pickPanel = selected ? (
    <InvoiceReconcilePickPanel
      inline
      cycle={selected}
      stagedCandidate={selectedDraft?.candidate ?? null}
      busy={workingKey === selected.key}
      onClose={closeInspector}
      onConfirm={(_id, candidate) => stageDraftLink(selected, candidate, 'manual')}
      onUnmatch={() => unmatch(selected)}
      onSkip={() => skipMatch(selected)}
    />
  ) : null

  const listArea = loading ? (
    <CadastroListPageLoading label="Carregando histórico de faturas…" />
  ) : !filtersApplied ? (
    <CadastroListPageEmptyCard
      icon={<Filter size={32} className="text-gray-400" />}
      title="Nenhum filtro aplicado"
      description="Selecione o ano (ou Todos) e clique em Aplicar para carregar ciclos e sugerir vínculos no extrato."
    />
  ) : allCycles.length === 0 ? (
    <CadastroListPageEmptyCard
      icon={<Link2 size={32} className="text-gray-400" />}
      title="Nenhuma fatura para reconciliar"
      description="Importe faturas de cartão para montar os ciclos e cruzar com o extrato."
    />
  ) : scopedCycles.length === 0 ? (
    <CadastroListPageEmptyCard
      icon={<Link2 size={32} className="text-gray-400" />}
      title="Nenhum ciclo neste ano"
      description="Troque o ano ou use Todos para ver o histórico completo."
    />
  ) : filtered.length === 0 && search.trim() ? (
    <CadastroListPageEmptyCard
      icon={<Link2 size={32} className="text-gray-400" />}
      title="Nenhum ciclo neste filtro"
      description="Ajuste a busca ou troque de aba."
    />
  ) : filtered.length === 0 ? (
    <CadastroListPageEmptyCard
      icon={tab === 'pending' ? <CheckCircle2 size={32} className="text-emerald-500" /> : <Link2 size={32} className="text-gray-400" />}
      title={emptyTab.title}
      description={emptyTab.description}
    />
  ) : (
    <div className={listPageTableSectionCls}>
      <ListPageTable
        leadingMode={bulkSelectTab ? 'bulk' : 'index-only'}
        colsRest={<ListTableSpacerCol />}
        head={
          <tr>
            {bulkSelectTab ? (
              <ListTableCheckboxHeader state={rowSelectAllState} onToggle={toggleRowSelectAll} />
            ) : (
              <ListTableIndexHeader />
            )}
            {bulkSelectTab ? <ListTableIndexHeader /> : null}
            <ListTableSpacerHeader />
            <ListTableStaticHeader label="Mês" className="w-[5.5rem]" />
            <ListTableStaticHeader label="Fechamento" className="w-[7rem]" />
            <ListTableStaticHeader label="Vencimento" className="w-[7rem]" />
            <ListTableStaticHeader label="Ciclo" className="min-w-[10rem]" />
            <ListTableStaticHeader label="Líquido" className="w-[7rem]" />
            <ListTableStaticHeader label="Status" className="w-[11rem]" />
            <ListTableStaticHeader label="Extrato vinculado" />
          </tr>
        }
      >
        {sortedRows.map((cycle, index) => renderCycleRow(cycle, index))}
      </ListPageTable>
    </div>
  )

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scroll={false}
          pinTabs
          header={
            <CadastroListPageHero
              icon={<Link2 className="h-8 w-8" />}
              title="Reconciliação de Faturas"
              subtitle="Aplique o filtro para carregar ciclos e sugestões do extrato — revise e salve no rodapé"
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onApply={() => void applyFilters()}
              applying={loading}
              resultHint={filtersApplied ? yearHint : undefined}
            >
              <CadastroFilterField label="Ano" icon={<Calendar size={12} />}>
                <select
                  value={draftYear}
                  onChange={(event) => setDraftYear(event.target.value)}
                  className={cadastroFilterFieldCls}
                  disabled={loading}
                >
                  <option value="">Todos</option>
                  {yearOptions.map((option) => (
                    <option key={option} value={String(option)}>{option}</option>
                  ))}
                </select>
              </CadastroFilterField>
            </CadastroListPageFilterCard>
          }
        >
          <div
            className={`flex min-h-0 min-w-0 flex-1 overflow-hidden -mx-6 -mt-3 lg:-mx-8 ${
              footerVisible ? 'pb-16 -mb-4' : '-mb-4'
            }`}
          >
            <PageScrollRoot
              ref={scrollContainerRef}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-slim bg-gray-50 px-6 pb-4 pt-3 dark:bg-gray-900 lg:px-8"
            >
              {showQueue && allCycles.length > 0 ? (
                <CadastroListPageTabs
                  tabs={[
                    { key: 'pending', label: 'Pendentes', count: counts.pending },
                    { key: 'matched', label: 'Vinculados', count: counts.matched },
                    { key: 'unlinked', label: 'Não vinculados', count: counts.unlinked },
                  ]}
                  active={tab}
                  onChange={setTab}
                  trailing={
                    <div className="w-72">
                      <CadastroListPageSearchField
                        value={search}
                        onChange={setSearch}
                        placeholder="Buscar ciclo, cartão, extrato…"
                      />
                    </div>
                  }
                />
              ) : null}
              {listArea}
            </PageScrollRoot>

            {showDesktopInspector ? (
              <aside className="flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-slate-100 p-3 pb-0 dark:border-gray-700 dark:bg-gray-950">
                <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_24px_rgba(0,0,0,0.10)] dark:bg-gray-800 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_4px_24px_rgba(0,0,0,0.45)]">
                  {pickPanel}
                </div>
              </aside>
            ) : null}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>

      {showMobileInspector ? (
        <CadastroModalShell maxWidth="max-w-md" maxHeight="max-h-[92vh]" onBackdropClick={closeInspector}>
          <CadastroModalHeader
            isEdit={false}
            title="Conciliar fatura"
            subtitle={selected ? `${selected.name} · ${selected.year_month}` : undefined}
            onClose={closeInspector}
            icon={<Link2 size={18} />}
          />
          <CadastroModalBody scrollable={false}>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pickPanel}
            </div>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeInspector} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      ) : null}

      {footerVisible ? (
        <FloatingFooterBar>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {footerSaveVisible ? (
              <span className="font-medium text-color-primary">
                {savableSelectedCount}{' '}
                {savableSelectedCount === 1 ? 'vínculo pronto para salvar' : 'vínculos prontos para salvar'}
              </span>
            ) : footerUnmatchVisible ? (
              <span className="font-medium text-color-primary">
                {selectedMatchedCount}{' '}
                {selectedMatchedCount === 1 ? 'ciclo selecionado' : 'ciclos selecionados'}
              </span>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {footerSaveVisible ? (
                <button
                  type="button"
                  onClick={() => void saveSelectedDrafts()}
                  disabled={workingKey !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--color-save)', color: 'var(--on-color-save)' }}
                >
                  {workingKey === 'save-drafts' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Salvar vínculos ({savableSelectedCount})
                </button>
              ) : null}
              {footerUnmatchVisible ? (
                <button
                  type="button"
                  onClick={() => setShowUnmatchConfirm(true)}
                  disabled={workingKey !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-danger, #dc2626)', color: '#fff' }}
                >
                  {workingKey === 'unmatch-bulk' ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                  Desvincular ({selectedMatchedCount})
                </button>
              ) : null}
              {showBackToTop ? (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Voltar ao Topo
                </button>
              ) : null}
            </div>
          </div>
        </FloatingFooterBar>
      ) : null}

      <ConfirmDialog
        isOpen={showUnmatchConfirm}
        onClose={() => setShowUnmatchConfirm(false)}
        onConfirm={() => void unmatchSelected()}
        title="Desvincular ciclos selecionados"
        message={`Desfazer ${selectedMatchedCount} ${
          selectedMatchedCount === 1 ? 'vínculo' : 'vínculos'
        } com o extrato? Os ciclos voltam para Pendentes.`}
        confirmText="Desvincular"
        cancelText="Cancelar"
        type="danger"
      />

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </div>
  )
}

export default ReconciliacaoPage
