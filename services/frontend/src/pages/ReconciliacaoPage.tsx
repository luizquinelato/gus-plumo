import { useCallback, useEffect, useMemo, useState } from 'react'
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
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import PageScrollRoot from '../components/PageScrollRoot'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import Toast from '../components/Toast'
import { InvoiceReconcilePickPanel } from '../components/InvoiceReconcilePickPanel'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  flattenReconcileCycles,
  type InvoiceMatchCycle,
  type InvoiceMatchHistory,
} from '../types/invoiceReconcile'
import { Calendar, CheckCircle2, Filter, Link2, Loader2, Wand2 } from 'lucide-react'

type ReconcileTab = 'pending' | 'matched' | 'unlinked'

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
    monthLabel: month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : yearMonth,
  }
}

const statusMeta = (status: InvoiceMatchCycle['status']) => {
  if (status === 'matched') return { tone: 'success' as const, label: 'Vinculado' }
  if (status === 'unlinked') return { tone: 'info' as const, label: 'Não vinculado' }
  return { tone: 'neutral' as const, label: 'Pendente' }
}

const isPendingCycle = (cycle: InvoiceMatchCycle) =>
  cycle.status === 'unmatched' || cycle.status === 'ambiguous'

const autoResultToast = (applied: number, skippedMultiple: number) => {
  if (applied > 0 && skippedMultiple > 0) {
    return {
      message:
        `${applied} ${applied === 1 ? 'vínculo feito' : 'vínculos feitos'}. ` +
        `${skippedMultiple} ${skippedMultiple === 1 ? 'ciclo continua pendente' : 'ciclos continuam pendentes'}: ` +
        'o valor da fatura aparece em mais de um débito no extrato. Escolha o lançamento correto.',
      type: 'warning' as const,
      duration: 8000,
    }
  }
  if (skippedMultiple > 0) {
    return {
      message: skippedMultiple === 1
        ? 'Não foi possível vincular automaticamente: o valor da fatura aparece em mais de um débito no extrato. Escolha o lançamento correto.'
        : `Não foi possível vincular automaticamente ${skippedMultiple} ciclos: o valor da fatura aparece em mais de um débito no extrato. Escolha o lançamento correto em cada um.`,
      type: 'warning' as const,
      duration: 8000,
    }
  }
  if (applied > 0) {
    return {
      message: `${applied} ${applied === 1 ? 'vínculo automático' : 'vínculos automáticos'}`,
      type: 'success' as const,
      duration: 3000,
    }
  }
  return {
    message: 'Nenhum ciclo com um único débito no valor da fatura.',
    type: 'warning' as const,
    duration: 5000,
  }
}

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
  const [history, setHistory] = useState<InvoiceMatchHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<ReconcileTab>('pending')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [workingKey, setWorkingKey] = useState<string | null>(null)
  const [draftYear, setDraftYear] = useState(currentYear)
  const [appliedYear, setAppliedYear] = useState('')
  const [filtersApplied, setFiltersApplied] = useState(false)
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

  const loadHistory = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const response = await axios.get<InvoiceMatchHistory>('/api/invoice-payment-matches/preview-history')
      setHistory(response.data)
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao carregar reconciliação', 'error')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

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

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, InvoiceMatchCycle[]>()
    filtered.forEach((cycle) => {
      const list = grouped.get(cycle.year_month) ?? []
      list.push(cycle)
      grouped.set(cycle.year_month, list)
    })
    return [...grouped.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([yearMonth, cycles]) => {
        const period = parseYearMonth(yearMonth)
        return {
          yearMonth,
          title: period.year ? `${period.monthLabel} ${period.year}` : yearMonth,
          cycles,
          total: cycles.reduce((sum, cycle) => sum + cycle.amount_to_pay, 0),
        }
      })
  }, [filtered])

  const selected = allCycles.find((cycle) => cycle.key === selectedKey) ?? null

  useEffect(() => {
    if (selectedKey && !allCycles.some((cycle) => cycle.key === selectedKey)) {
      setSelectedKey(null)
    }
  }, [allCycles, selectedKey])

  const confirmMatch = async (cycle: InvoiceMatchCycle, bankStatementId: number) => {
    setWorkingKey(cycle.key)
    try {
      await axios.post('/api/invoice-payment-matches/', {
        year_month: cycle.year_month,
        bank_statement_id: bankStatementId,
        invoice_group_id: cycle.invoice_group_id,
        credit_card_id: cycle.credit_card_id,
        match_method: 'manual',
      })
      showToast('Vínculo confirmado', 'success')
      await loadHistory({ silent: true })
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao vincular pagamento', 'error')
    } finally {
      setWorkingKey(null)
    }
  }

  const unmatch = async (cycle: InvoiceMatchCycle) => {
    if (!cycle.match) return
    setWorkingKey(cycle.key)
    try {
      await axios.delete(`/api/invoice-payment-matches/${cycle.match.id}`)
      showToast(cycle.status === 'unlinked' ? 'Marca de não vinculado removida' : 'Vínculo desfeito', 'success')
      await loadHistory({ silent: true })
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
      await loadHistory({ silent: true })
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro ao marcar como não vinculado', 'error')
    } finally {
      setWorkingKey(null)
    }
  }

  const runAuto = async () => {
    setWorkingKey('auto')
    try {
      const response = await axios.post('/api/invoice-payment-matches/auto-history')
      setHistory(response.data.preview)
      const applied = response.data.applied_count ?? 0
      const skippedMultiple = response.data.skipped_multiple_count
        ?? flattenReconcileCycles(response.data.preview).filter((cycle) => cycle.multiple_debits).length
      const result = autoResultToast(applied, skippedMultiple)
      showToast(result.message, result.type, result.duration)
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erro no match automático', 'error')
    } finally {
      setWorkingKey(null)
    }
  }

  const applyFilters = () => {
    setAppliedYear(draftYear)
    setFiltersApplied(true)
    setSelectedKey(null)
  }

  const clearFilters = () => {
    setDraftYear('')
    setAppliedYear('')
    setFiltersApplied(false)
    setSearch('')
    setSelectedKey(null)
  }

  const autoCount = allCycles.filter((cycle) => cycle.auto_eligible).length
  const pendingCount = allCycles.filter(isPendingCycle).length
  const hasActiveFilters = draftYear !== '' || filtersApplied
  const showQueue = filtersApplied && !loading
  const showDesktopInspector = Boolean(selected) && isDesktop
  const showMobileInspector = Boolean(selected) && !isDesktop
  const emptyTab = emptyCopyForTab(tab)
  const yearHint = appliedYear || 'Todos'

  const pickPanel = selected ? (
    <InvoiceReconcilePickPanel
      inline
      cycle={selected}
      busy={workingKey === selected.key}
      onClose={closeInspector}
      onConfirm={(id) => confirmMatch(selected, id)}
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
      description="Selecione o ano (ou Todos) e clique em Aplicar para ver a fila de ciclos."
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
    <div className="flex flex-col gap-6">
      {monthGroups.map((group) => (
        <section key={group.yearMonth}>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{group.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {group.cycles.length} {group.cycles.length === 1 ? 'ciclo' : 'ciclos'}
              <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {formatCurrency(group.total)}
              </span>
            </p>
          </div>
          <ListPageTable
            colsRest={<ListTableSpacerCol />}
            head={
              <tr>
                <ListTableIndexHeader />
                <ListTableSpacerHeader />
                <ListTableStaticHeader label="Ciclo" className="w-[36%]" />
                <ListTableStaticHeader label="Líquido" className="w-[14%]" />
                <ListTableStaticHeader label="Status" className="w-[16%]" />
                <ListTableStaticHeader label="Extrato vinculado" />
              </tr>
            }
          >
            {group.cycles.map((cycle, index) => {
              const meta = statusMeta(cycle.status)
              const selectedRow = selectedKey === cycle.key
              return (
                <tr
                  key={cycle.key}
                  className={`${listPageTableRowHoverCls} cursor-pointer ${
                    selectedRow
                      ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]'
                      : ''
                  }`}
                  onClick={() => setSelectedKey(selectedRow ? null : cycle.key)}
                >
                  <ListTableIndexCell index={index + 1} />
                  <ListTableSpacerCell />
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
                    <Badge
                      variant={badgeVariantForColumnRole('statusPrimary')}
                      tone={meta.tone}
                      label={meta.label}
                    />
                  </td>
                  <td className={listPageTableTdCls}>
                    {cycle.status === 'unlinked' ? (
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
            })}
          </ListPageTable>
        </section>
      ))}
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
              subtitle="Vínculos entre o ciclo da fatura (grupo ou cartão) e o débito no extrato"
              actions={
                <button
                  type="button"
                  onClick={runAuto}
                  disabled={pendingCount === 0 || workingKey !== null || loading}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
                >
                  {workingKey === 'auto' ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  Vincular automaticamente{autoCount > 0 ? ` (${autoCount})` : ''}
                </button>
              }
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onApply={applyFilters}
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
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden -mx-6 -mb-4 -mt-3 lg:-mx-8">
            <PageScrollRoot className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-slim bg-gray-50 px-6 pb-20 pt-3 dark:bg-gray-900 lg:px-8">
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
              <aside className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-slate-100 p-3 dark:border-gray-700 dark:bg-gray-950">
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
