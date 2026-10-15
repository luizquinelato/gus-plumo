import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsRight, Copy, CreditCard, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { DateField } from '../components/date'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPrimaryButton,
  listPageTableRowHoverCls,
} from '../components/CadastroListPageLayout'
import { ListPageNestedTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  cadastroFieldCls,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import LoadingSpinner from '../components/LoadingSpinner'
import { formatCurrency } from '../utils/currency'

type Kind = 'fixed' | 'variable'
type View = 'total' | 'mine'

interface BreakdownItem {
  card_id: number
  card_name: string
  card_number: string
  amount: string
  my_amount: string
}

interface Expense {
  id: number
  year_month: string
  expected_date: string
  description: string
  amount: string
  my_amount: string
  kind: Kind
  source: 'manual' | 'clone' | 'card_invoice' | 'card_item' | 'payroll'
  breakdown?: BreakdownItem[] | null
  editable?: boolean
  is_actual?: boolean
}

interface Totals {
  fixed: string
  variable: string
  total: string
  my_fixed: string
  my_variable: string
  my_total: string
}

interface Income {
  id: number
  editable: boolean
  description: string
  amount: string
  expected_date: string
}

interface CardOption {
  id: number
  name: string
  number: string
  type: string
  active?: boolean
  invoice_group_id?: number | null
  invoice_group_name?: string | null
}

interface CardItemForm {
  card_id: number
  description: string
  amount: string
  kind: Kind
}

interface CardFormState {
  cardIds: number[]
  historyMonths: number
  mode: 'auto' | 'manual'
  method: 'average' | 'installments'
  items: CardItemForm[]
}

interface InstallmentPreview {
  card_id: number
  card_name: string
  card_number: string
  description: string
  installment: number
  total_installments: number
  amount: string
  my_amount: string
}

interface MonthData {
  year_month: string
  items: Expense[]
  totals: Totals
  income?: Income[]
  income_total?: string
}

interface FormState {
  id?: number
  expected_date: string
  description: string
  amount: string
  kind: Kind
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const debit = (value: number) => (value > 0 ? `-${formatCurrency(value)}` : formatCurrency(0))
const debitCls = 'text-red-600 dark:text-red-400'
const creditCls = 'text-green-600 dark:text-green-400'

export default function ProjecaoMensalPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [view, setView] = useState<View>('total')
  const [data, setData] = useState<MonthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<Expense | null>(null)
  const closeDetail = useCallback(() => setDetail(null), [])
  useEscapeKey(closeDetail, detail != null)
  const closeForm = useCallback(() => setForm(null), [])
  useEscapeKey(closeForm, form != null && detail == null)
  const [cardForm, setCardForm] = useState<CardFormState | null>(null)
  const [cardOptions, setCardOptions] = useState<CardOption[]>([])
  const cardGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; cards: CardOption[] }>()
    for (const c of cardOptions) {
      const key = c.invoice_group_id ? `g${c.invoice_group_id}` : 'none'
      const name = c.invoice_group_id ? c.invoice_group_name || 'Grupo' : 'Sem grupo'
      if (!map.has(key)) map.set(key, { key, name, cards: [] })
      map.get(key)!.cards.push(c)
    }
    return [...map.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name)))
  }, [cardOptions])
  const [installmentPreview, setInstallmentPreview] = useState<InstallmentPreview[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewActive = cardForm?.mode === 'auto' && cardForm.method === 'installments'
  const previewCardKey = cardForm ? cardForm.cardIds.join(',') : ''
  useEffect(() => {
    if (!previewActive || !previewCardKey) {
      setInstallmentPreview([])
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    axios
      .get<InstallmentPreview[]>('/api/monthly-projections/installments-preview', {
        params: { year_month: yearMonth, card_ids: previewCardKey },
      })
      .then((res) => !cancelled && setInstallmentPreview(res.data))
      .catch((err) => {
        console.error('Erro ao carregar parcelas do mês:', err)
        if (!cancelled) setInstallmentPreview([])
      })
      .finally(() => !cancelled && setPreviewLoading(false))
    return () => {
      cancelled = true
    }
  }, [previewActive, previewCardKey, yearMonth])
  const closeCardForm = useCallback(() => setCardForm(null), [])
  useEscapeKey(closeCardForm, cardForm != null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get<MonthData>('/api/monthly-projections', { params: { year_month: yearMonth } })
      setData(res.data)
    } catch (err) {
      console.error('Erro ao carregar gastos esperados:', err)
      setError('Não foi possível carregar os gastos esperados.')
    } finally {
      setLoading(false)
    }
  }, [yearMonth])

  useEffect(() => {
    void load()
  }, [load])

  const valueOf = useCallback(
    (e: Expense) => Number(view === 'mine' ? e.my_amount : e.amount),
    [view],
  )

  const byDay = useMemo(() => {
    const map = new Map<number, Expense[]>()
    for (const item of data?.items ?? []) {
      const day = Number(item.expected_date.slice(8, 10))
      map.set(day, [...(map.get(day) ?? []), item])
    }
    return map
  }, [data])

  const incomeByDay = useMemo(() => {
    const map = new Map<number, Income[]>()
    for (const item of data?.income ?? []) {
      const day = Number(item.expected_date.slice(8, 10))
      map.set(day, [...(map.get(day) ?? []), item])
    }
    return map
  }, [data])

  const cells = useMemo(() => {
    const [y, m] = yearMonth.split('-').map(Number)
    const offset = new Date(y, m - 1, 1).getDay()
    const days = new Date(y, m, 0).getDate()
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[]
  }, [yearMonth])

  const amountNum = form ? parseFloat(form.amount) : NaN
  const amountColor = amountNum > 0 ? creditCls : amountNum < 0 ? debitCls : 'text-gray-600 dark:text-gray-400'

  const openNew = (day: number) =>
    setForm({ expected_date: `${yearMonth}-${String(day).padStart(2, '0')}`, description: '', amount: '', kind: 'fixed' })

  const openEdit = (e: Expense) =>
    e.source === 'card_invoice'
      ? setDetail(e)
      : e.editable !== false &&
        setForm({ id: e.id, expected_date: e.expected_date, description: e.description, amount: `-${e.amount}`, kind: e.kind })

  const openEditIncome = (inc: Income) =>
    inc.editable &&
    setForm({ id: inc.id, expected_date: inc.expected_date, description: inc.description, amount: inc.amount, kind: 'fixed' })

  const launchIncome = async () => {
    try {
      await axios.post('/api/monthly-projections/launch-income', { year_month: yearMonth })
      await load()
    } catch (err) {
      console.error('Erro ao lançar projeção de receitas:', err)
      setError('Não foi possível lançar a projeção de receitas.')
    }
  }

  const openCardForm = async () => {
    try {
      const res = await axios.get<CardOption[]>('/api/cartoes/')
      const credit = res.data.filter((c) => c.type === 'credito' && c.active !== false)
      setCardOptions(credit)
      setCardForm({ cardIds: credit.map((c) => c.id), historyMonths: 6, mode: 'auto', method: 'average', items: [] })
    } catch (err) {
      console.error('Erro ao carregar cartões:', err)
      setError('Não foi possível carregar os cartões.')
    }
  }

  const updateCardItem = (index: number, patch: Partial<CardItemForm>) =>
    setCardForm((prev) => prev && { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })

  const launchCards = async () => {
    if (!cardForm) return
    const auto = cardForm.mode === 'auto'
    setSaving(true)
    try {
      await axios.post('/api/monthly-projections/launch-cards', {
        year_month: yearMonth,
        card_ids: auto ? cardForm.cardIds : cardOptions.map((c) => c.id),
        history_months: cardForm.historyMonths,
        include_average: auto && cardForm.method === 'average',
        include_installments: auto && cardForm.method === 'installments',
        items: auto ? [] : cardForm.items.map((it) => ({ ...it, amount: Number(it.amount) })),
      })
      setCardForm(null)
      await load()
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setError(typeof msg === 'string' ? msg : 'Não foi possível lançar a projeção de cartões.')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const body = {
        expected_date: form.expected_date,
        description: form.description,
        amount: Number(form.amount),
        kind: form.kind,
      }
      if (form.id) await axios.put(`/api/monthly-projections/${form.id}`, body)
      else await axios.post('/api/monthly-projections', body)
      setForm(null)
      await load()
    } catch (err) {
      console.error('Erro ao salvar gasto esperado:', err)
      setError('Não foi possível salvar o gasto.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!form?.id) return
    try {
      await axios.delete(`/api/monthly-projections/${form.id}`)
      setForm(null)
      await load()
    } catch (err) {
      console.error('Erro ao excluir gasto esperado:', err)
      setError('Não foi possível excluir o gasto.')
    }
  }

  const cloneNext = async () => {
    try {
      await axios.post('/api/monthly-projections/clone', { source_year_month: yearMonth })
      setYearMonth(shiftMonth(yearMonth, 1))
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setError(typeof detail === 'string' ? detail : 'Não foi possível clonar o mês.')
    }
  }

  const [year, month] = yearMonth.split('-').map(Number)
  const totals = data?.totals
  const t = (total: string | undefined, mine: string | undefined) => Number((view === 'mine' ? mine : total) ?? 0)
  const result = Number(data?.income_total ?? 0) - t(totals?.total, totals?.my_total)

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scroll={false}
          header={
            <CadastroListPageHero
              icon={<CalendarDays className="w-8 h-8" />}
              title="Projeção Mensal"
              subtitle="Planejamento mensal de entradas e gastos fixos e variáveis"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    menuTitle: 'Lançar projeções',
                    extraItems: [
                      { id: 'income', label: 'Lançar projeção de receitas', icon: <Wallet size={16} />, onClick: launchIncome },
                      { id: 'cards', label: 'Lançar projeção de cartões', icon: <CreditCard size={16} />, onClick: openCardForm },
                    ],
                  }}
                >
                  <CadastroListPrimaryButton
                    label="Clonar para o Próximo Mês"
                    icon={<Copy size={18} />}
                    onClick={cloneNext}
                  />
                </CadastroListHeaderActions>
              }
            />
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-slim">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setYearMonth(shiftMonth(yearMonth, -1))} className="rounded-lg border border-gray-300 p-2 dark:border-gray-600" aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="min-w-[10rem] text-center text-lg font-semibold text-gray-900 dark:text-white">
                {MONTH_NAMES[month - 1]} {year}
              </h2>
              <button type="button" onClick={() => setYearMonth(shiftMonth(yearMonth, 1))} className="rounded-lg border border-gray-300 p-2 dark:border-gray-600" aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </button>
              <select value={view} onChange={(e) => setView(e.target.value as View)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                <option value="total">Visão total</option>
                <option value="mine">Minha parte</option>
              </select>
              <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <span className="h-[3px] w-5 rounded-full bg-[var(--color-1)]" />
                Divisor entre os dias 14 e 15
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500">Entradas</p>
                <p className={`text-lg font-semibold ${creditCls}`}>{formatCurrency(Number(data?.income_total ?? 0))}</p>
              </div>
              {[
                ['Gastos Fixos', t(totals?.fixed, totals?.my_fixed)],
                ['Gastos Variáveis', t(totals?.variable, totals?.my_variable)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-semibold ${debitCls}`}>{debit(value as number)}</p>
                </div>
              ))}
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500">Resultado</p>
                <p className={`text-lg font-semibold ${result >= 0 ? creditCls : debitCls}`}>{formatCurrency(result)}</p>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {loading ? (
              <LoadingSpinner />
            ) : (
              <div
                className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-700 dark:bg-gray-700"
                style={{ gridTemplateRows: `auto repeat(${Math.ceil(cells.length / 7)}, minmax(96px, 1fr))` }}
              >
                {WEEKDAYS.map((d) => (
                  <div key={d} className="bg-gray-100 p-2 text-center text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{d}</div>
                ))}
                {cells.map((day, i) => {
                  const items = day ? byDay.get(day) ?? [] : []
                  const dayTotal = items.reduce((s, e) => s + valueOf(e), 0)
                  // Divisor entre os dias 14 e 15: borda inferior nos dias 8–14 (acima da 2ª metade)
                  // e borda direita no dia 14 quando o 15 está na mesma linha.
                  const shadows: string[] = []
                  if (day !== null && day >= 8 && day <= 14) shadows.push('inset 0 -3px 0 0 var(--color-1)')
                  if (day === 14 && i % 7 < 6) shadows.push('inset -3px 0 0 0 var(--color-1)')
                  return (
                    <div
                      key={i}
                      style={shadows.length ? { boxShadow: shadows.join(', ') } : undefined}
                      className={`group relative min-h-[96px] p-1.5 ${
                        day === null ? 'bg-gray-50 dark:bg-gray-950' : 'bg-white dark:bg-gray-900'
                      }`}
                    >
                      {day === 15 && (
                        <span
                          title="Segunda metade do mês (dia 15 em diante)"
                          className={`pointer-events-none absolute top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-1)] text-white shadow ${
                            i % 7 === 0 ? 'left-1' : 'left-0 -translate-x-1/2'
                          }`}
                        >
                          <ChevronsRight className="h-4 w-4" />
                        </span>
                      )}
                      {day && (
                        <>
                          <div className="flex items-center justify-between text-base font-semibold text-gray-700 dark:text-gray-200">
                            <span>{day}</span>
                            <button type="button" onClick={() => openNew(day)} className="rounded p-1 opacity-0 hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700" aria-label={`Adicionar lançamento no dia ${day}`}>
                              <Plus className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="mt-1 space-y-1">
                            {(incomeByDay.get(day) ?? []).map((inc) => (
                              <button
                                key={inc.id}
                                type="button"
                                disabled={!inc.editable}
                                onClick={() => openEditIncome(inc)}
                                title={inc.editable ? 'Receita lançada' : 'Projeção automática: lance novamente para atualizar'}
                                className="flex w-full items-center justify-between gap-1 rounded bg-green-50 px-1.5 py-1 text-left text-[11px] text-green-900 disabled:cursor-default dark:bg-green-900/30 dark:text-green-100"
                              >
                                <span className="truncate">{inc.description}</span>
                                <span className={`shrink-0 font-semibold ${creditCls}`}>{formatCurrency(Number(inc.amount))}</span>
                              </button>
                            ))}
                            {items.map((e) => (
                              <button key={e.id} type="button" onClick={() => openEdit(e)} className={`flex w-full items-center justify-between gap-1 rounded px-1.5 py-1 text-left text-[11px] ${e.kind === 'fixed' ? 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100' : 'bg-orange-50 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100'}`}>
                                <span className="truncate">{e.description}</span>
                                <span className={`shrink-0 font-semibold ${debitCls}`}>{debit(valueOf(e))}</span>
                              </button>
                            ))}
                          </div>
                          {items.length > 1 && <p className={`mt-1 text-right text-[10px] font-semibold ${debitCls}`}>{debit(dayTotal)}</p>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>

      {detail && (
        <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={() => setDetail(null)}>
          <CadastroModalHeader
            isEdit={false}
            title={detail.description}
            titleAddon={
              <span
                className={`inline-flex w-[88px] items-center justify-center rounded px-3 py-1 text-xs font-semibold text-white ${
                  detail.is_actual ? 'bg-green-600' : 'bg-amber-600'
                }`}
              >
                {detail.is_actual ? 'Fatura real' : 'Estimativa'}
              </span>
            }
            subtitle={`${detail.is_actual ? 'Valor da fatura' : 'Média dos últimos 6 meses'} • vencimento ${detail.expected_date.split('-').reverse().join('/')}`}
            onClose={() => setDetail(null)}
            icon={<CreditCard size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Cartões" icon={<CreditCard size={14} />} bodyClassName="p-0">
              <ListPageNestedTable
                alignWithListLeading
                leadingMode="index-only"
                colsRest={
                  <>
                    <ListTableSpacerCol />
                    <col />
                    <col style={{ width: 160 }} />
                  </>
                }
                head={
                  <tr>
                    <ListTableIndexHeader />
                    <ListTableSpacerHeader />
                    <ListTableStaticHeader label="Cartão" className="px-3 py-2" />
                    <ListTableStaticHeader label={view === 'mine' ? 'Minha parte' : 'Total'} className="px-3 py-2 text-right" />
                  </tr>
                }
              >
                {(detail.breakdown?.length ? detail.breakdown : [{ card_id: 0, card_name: detail.description, card_number: '', amount: detail.amount, my_amount: detail.my_amount }]).map((b, i) => (
                  <tr key={b.card_id} className={listPageTableRowHoverCls}>
                    <ListTableIndexCell index={i + 1} />
                    <ListTableSpacerCell />
                    <td className="px-3 py-2">{b.card_name}{b.card_number ? ` •${b.card_number}` : ''}</td>
                    <td className={`px-3 py-2 text-right ${debitCls}`}>{debit(Number(view === 'mine' ? b.my_amount : b.amount))}</td>
                  </tr>
                ))}
              </ListPageNestedTable>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setDetail(null)}
            closeLabel="Fechar"
            hideSave
            leading={
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Total <span className={debitCls}>{debit(valueOf(detail))}</span>
              </span>
            }
          />
        </CadastroModalShell>
      )}

      {form && (
        <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={closeForm}>
          <CadastroModalHeader
            isEdit={Boolean(form.id)}
            title={form.id ? 'Editar lançamento' : 'Novo lançamento'}
            subtitle="Lançamento esperado do mês"
            onClose={closeForm}
            icon={form.id ? <Pencil size={18} /> : <Plus size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Dados" icon={<CalendarDays size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={3}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Data</CadastroFieldLabel>
                    <DateField
                      value={form.expected_date}
                      onChange={(value) => setForm({ ...form, expected_date: value })}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>
                      Valor {amountNum !== 0 && !isNaN(amountNum) ? (
                        <span className={`font-semibold ${amountColor}`}>
                          ({amountNum > 0 ? 'Receita' : 'Despesa'})
                        </span>
                      ) : null}
                    </CadastroFieldLabel>
                    <div className="relative mt-0.5">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-gray-400">
                        R$
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.amount}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
                          const n = parseFloat(value)
                          if (!isNaN(n) && Math.abs(n) > 99999999.99) return
                          setForm({ ...form, amount: value })
                        }}
                        onBlur={() => {
                          const n = parseFloat(form.amount)
                          if (!isNaN(n)) setForm({ ...form, amount: n.toFixed(2) })
                        }}
                        placeholder="0.00"
                        className={`${cadastroFieldCls} pl-10 font-semibold ${amountColor}`}
                      />
                    </div>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Tipo</CadastroFieldLabel>
                    <select
                      value={form.kind}
                      onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
                      disabled={amountNum > 0}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value="fixed">Fixo</option>
                      <option value="variable">Variável</option>
                    </select>
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Descrição</CadastroFieldLabel>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeForm}
            onSave={save}
            saving={saving}
            disabled={saving || !form.description.trim() || !amountNum || isNaN(amountNum)}
            leading={
              form.id ? (
                <button
                  type="button"
                  onClick={remove}
                  className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400"
                >
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
              ) : undefined
            }
          />
        </CadastroModalShell>
      )}

      {cardForm && (
        <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={closeCardForm}>
          <CadastroModalHeader
            isEdit={false}
            title="Lançar projeção de cartões"
            subtitle={`${MONTH_NAMES[month - 1]} ${year} • substitui as projeções de cartão já lançadas no mês`}
            onClose={closeCardForm}
            icon={<CreditCard size={18} />}
          />
          <CadastroModalBody>
            <div className="flex justify-start px-4 pt-4">
              <div role="radiogroup" className="flex w-56 rounded-lg bg-gray-200 p-0.5 dark:bg-black/40">
                {(['auto', 'manual'] as const).map((m) => {
                  const active = cardForm.mode === m
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setCardForm({ ...cardForm, mode: m })}
                      className={`flex flex-1 items-center justify-center rounded-md py-1.5 text-xs transition-all ${
                        active
                          ? 'bg-[var(--color-1)] font-semibold text-white shadow-[0_1px_4px_rgba(0,0,0,.3)]'
                          : 'font-medium text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {m === 'auto' ? 'Automático' : 'Manual'}
                    </button>
                  )
                })}
              </div>
            </div>
            {cardForm.mode === 'auto' && (
            <CadastroFormSection title="Cálculo da projeção" icon={<CreditCard size={14} />}>
              <div className="mb-3 space-y-2">
                {cardForm.mode === 'auto' && (
                  <>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-800 dark:text-gray-100">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-method"
                          checked={cardForm.method === 'average'}
                          onChange={() => setCardForm({ ...cardForm, method: 'average' })}
                        />
                        Média das faturas
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-method"
                          checked={cardForm.method === 'installments'}
                          onChange={() => setCardForm({ ...cardForm, method: 'installments' })}
                        />
                        Saldo parcelado
                      </label>
                    </div>
                    {cardForm.method === 'average' && (
                      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                        Período
                        <input
                          type="number"
                          min={1}
                          max={24}
                          value={cardForm.historyMonths}
                          onChange={(e) => setCardForm({ ...cardForm, historyMonths: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })}
                          className={`${cadastroFieldCls} w-20`}
                        />
                        (meses)
                      </label>
                    )}
                  </>
                )}
              </div>
              {cardForm.mode === 'auto' && (
              <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-600">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={cardOptions.length > 0 && cardForm.cardIds.length === cardOptions.length}
                    ref={(el) => {
                      if (el) el.indeterminate = cardForm.cardIds.length > 0 && cardForm.cardIds.length < cardOptions.length
                    }}
                    onChange={(e) => setCardForm({ ...cardForm, cardIds: e.target.checked ? cardOptions.map((c) => c.id) : [] })}
                  />
                  Selecionar todos
                </label>
                {cardGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                      <input
                        type="checkbox"
                        checked={group.cards.every((c) => cardForm.cardIds.includes(c.id))}
                        ref={(el) => {
                          if (!el) return
                          const n = group.cards.filter((c) => cardForm.cardIds.includes(c.id)).length
                          el.indeterminate = n > 0 && n < group.cards.length
                        }}
                        onChange={(e) => {
                          const ids = group.cards.map((c) => c.id)
                          const rest = cardForm.cardIds.filter((id) => !ids.includes(id))
                          setCardForm({ ...cardForm, cardIds: e.target.checked ? [...rest, ...ids] : rest })
                        }}
                      />
                      {group.name}
                    </div>
                    <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
                      {group.cards.map((c) => (
                        <label
                          key={c.id}
                          className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-gray-800 dark:text-gray-100 ${
                            cardForm.cardIds.includes(c.id)
                              ? 'border-[var(--color-1)] bg-gray-50 dark:bg-gray-700/50'
                              : 'border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={cardForm.cardIds.includes(c.id)}
                            onChange={(e) =>
                              setCardForm({
                                ...cardForm,
                                cardIds: e.target.checked ? [...cardForm.cardIds, c.id] : cardForm.cardIds.filter((id) => id !== c.id),
                              })
                            }
                          />
                          <span className="truncate">{c.name || 'Sem nome'} •{c.number}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {cardOptions.length === 0 && <p className="text-sm text-gray-500">Nenhum cartão de crédito ativo.</p>}
              </div>
              )}
            </CadastroFormSection>
            )}
            {previewActive && (
              <CadastroFormSection title={`Parcelas de ${MONTH_NAMES[month - 1]}`} icon={<CreditCard size={14} />}>
                {previewLoading ? (
                  <p className="text-sm text-gray-500">Carregando…</p>
                ) : installmentPreview.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma parcela em aberto neste mês para os cartões selecionados.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                      {installmentPreview.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="min-w-0 truncate text-gray-800 dark:text-gray-100">
                            {p.description} ({p.installment}/{p.total_installments})
                            <span className="ml-2 text-xs text-gray-500">{p.card_name} •{p.card_number}</span>
                          </span>
                          <span className={`shrink-0 tabular-nums font-semibold ${debitCls}`}>{formatCurrency(Number(p.amount))}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-right text-sm font-semibold text-gray-800 dark:text-gray-100">
                      Total: {formatCurrency(installmentPreview.reduce((s, p) => s + Number(p.amount), 0))}
                    </p>
                  </>
                )}
              </CadastroFormSection>
            )}
            {cardForm.mode === 'manual' && (
            <CadastroFormSection title="Itens individuais (editáveis)" icon={<Plus size={14} />}>
              <div className="space-y-2">
                {cardForm.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.5fr_7rem_6rem_auto] items-center gap-2">
                    <select
                      value={item.card_id}
                      onChange={(e) => updateCardItem(i, { card_id: Number(e.target.value) })}
                      className={cadastroFieldCls}
                    >
                      {cardOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name || 'Sem nome'} •{c.number}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Descrição"
                      value={item.description}
                      onChange={(e) => updateCardItem(i, { description: e.target.value })}
                      className={cadastroFieldCls}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && updateCardItem(i, { amount: e.target.value })}
                      className={`${cadastroFieldCls} text-right font-semibold ${debitCls}`}
                    />
                    <select
                      value={item.kind}
                      onChange={(e) => updateCardItem(i, { kind: e.target.value as Kind })}
                      className={cadastroFieldCls}
                    >
                      <option value="fixed">Fixo</option>
                      <option value="variable">Variável</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setCardForm({ ...cardForm, items: cardForm.items.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-gray-700"
                      aria-label="Remover item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={cardOptions.length === 0}
                  onClick={() =>
                    setCardForm({
                      ...cardForm,
                      items: [...cardForm.items, { card_id: cardOptions[0].id, description: '', amount: '', kind: 'fixed' }],
                    })
                  }
                  className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-1)] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Adicionar item
                </button>
              </div>
            </CadastroFormSection>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeCardForm}
            onSave={launchCards}
            saving={saving}
            saveLabel="Lançar"
            disabled={
              saving ||
              (cardForm.mode === 'auto' && cardForm.cardIds.length === 0) ||
              (cardForm.mode === 'manual' &&
                (cardForm.items.length === 0 ||
                  cardForm.items.some((it) => !it.description.trim() || !(Number(it.amount) > 0))))
            }
          />
        </CadastroModalShell>
      )}

    </div>
  )
}
