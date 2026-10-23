import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import axios from 'axios'
import { ArrowUp, CalendarDays, CheckCircle, Clock, Download, Eye, Handshake, HelpCircle, Lock, Pencil, Percent, Trash2, TrendingUp, FileText, Unlock, Wallet } from 'lucide-react'
import Toast from '../components/Toast'
import ConsortiumProjectionModal from '../components/ConsortiumProjectionModal'
import { useConfirm } from '../hooks/useConfirm'
import Sidebar from '../components/Sidebar'
import FloatingFooterBar from '../components/FloatingFooterBar'
import {
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageSearchField,
  CadastroListPageShell,
  CadastroListPageTabs,
  listPageTableChromeFooterCls,
  listPageTableRowHoverCls,
  listPageTableSectionCls,
  reportRowActionBtnClass,
  reportTableChromeHeaderCls,
} from '../components/CadastroListPageLayout'
import {
  cadastroAccentControlCls,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { formatCurrency, formatCurrencyWithColor } from '../utils/currency'
import { ExportClosureModal } from '../components/ExportClosureModal'
import ConsortiumExportCharts, { EXPORT_CHART_COLORS } from '../components/ConsortiumExportCharts'
import { useExportRunner } from '../hooks/useExportRunner'
import { captureChartImage } from '../utils/saldoParceladoExportShared'
import {
  buildProjectionExport,
  defaultProjectionPremises,
  exportConsortiumExcel,
  exportConsortiumPdf,
  type ConsortiumDetailsExport,
  type ProjectionChartRow,
  type ProjectionPremises,
} from '../utils/consortiumExport'
import { buildBase } from '../utils/consortiumProjection'
import MonthPicker from '../components/MonthPicker'

interface Consortium {
  id: number
  company: string
  company_label: string
  segment: string
  segment_label: string
  group_code: string
  quota: string
  contract_number?: string | null
  asset_description?: string | null
  credit_amount?: number | null
  plan_term_months: number
  paid_installments: number
  catch_up_installments: number
  catch_up_installment_amount?: number | null
  reduction_factor?: number | null
  outstanding_balance?: number | null
  total_paid?: number | null
  remaining_installments: number
  open_regular_installments: number
  monthly_amount?: number | null
  joined_date?: string | null
  next_due_date?: string | null
  last_due_date?: string | null
  group_end_date?: string | null
  next_adjustment_date?: string | null
  admin_fee_pct?: number | null
  reserve_fund_pct?: number | null
  insurance_pct?: number | null
  paid_pct?: number | null
  pending_pct?: number | null
  to_collect_pct?: number | null
  ideal_paid_pct?: number | null
  ideal_due_pct?: number | null
  diff_pct?: number | null
  source_filename?: string | null
  active: boolean
  auto_closed: boolean
  is_closed: boolean
}

interface Installment {
  id: number
  installment_number?: number | null
  entry_code?: string | null
  entry_description: string
  due_date?: string | null
  payment_date?: string | null
  amount_due?: number | null
  amount_paid?: number | null
  fine_amount?: number | null
  interest_amount?: number | null
  notice_number?: string | null
}

/** Valor com cor pelo sinal (despesa vermelha, receita verde), igual às outras telas. */
const money = (v?: number | null) => (v == null ? '—' : formatCurrencyWithColor(v))
/** Total do furo = qtde de parcelas de furo × valor da parcela do furo (null se a parcela não foi informada). */
const catchUpTotal = (c: { catch_up_installments: number; catch_up_installment_amount?: number | null }) =>
  c.catch_up_installment_amount == null ? null : c.catch_up_installments * c.catch_up_installment_amount

/**
 * Custo total estimado = total pago + saldo devedor (a valores de hoje; ambos já refletem os reajustes
 * do crédito). Juros total = custo / crédito − 1. Juros anual = juros total / (prazo em meses / 12), simples.
 * O custo é despesa, então é devolvido negativo; o cálculo usa valores absolutos.
 */
const estimateTotalCost = (c: Consortium, totalPaid: number) => {
  const credit = c.credit_amount
  const balance = c.outstanding_balance
  if (balance == null || !credit || credit <= 0) return null
  const cost = Math.abs(totalPaid) + Math.abs(balance)
  const totalPct = (cost / credit - 1) * 100
  const years = c.plan_term_months / 12
  return { total: -cost, totalPct, annualPct: years > 0 ? totalPct / years : null }
}

const pct = (v?: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`)
const date = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—')

/** Máscara BRL: dígitos (centavos) → "1.234,56". */
const formatAmountMask = (cents: string): string =>
  (parseInt(cents || '0', 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const COMPANY_MARK: Record<string, { initial: string; bg: string }> = {
  porto_seguro: { initial: 'P', bg: '#0046C0' },
  rodobens: { initial: 'R', bg: '#00A651' },
}

/** Marca da administradora (monograma na cor da marca) — trocar por logo oficial quando houver arquivo. */
const CompanyMark = ({ company }: { company: string }) => {
  const mark = COMPANY_MARK[company]
  if (!mark) return <Handshake size={18} className="shrink-0 text-gray-400" />
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
      style={{ backgroundColor: mark.bg }}
      aria-hidden
    >
      {mark.initial}
    </span>
  )
}

const Field = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <CadastroFieldLabel>{label}</CadastroFieldLabel>
    <p className="mt-0.5 text-base font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
)

/** Cores do segmento (distintas do azul/verde das administradoras). */
const SEGMENT_BADGE_CLS: Record<string, string> = {
  auto: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  imovel: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
}
const SEGMENT_BADGE_FALLBACK_CLS = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'

const MiniInfo = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className="text-base font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
)

/** Estilo de tabela igual ao das telas de relatório (Extrato). */
const REPORT_TH =
  'px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 whitespace-nowrap dark:text-gray-300'
const REPORT_ROW = `${listPageTableRowHoverCls} border-t border-t-gray-200 border-l-4 border-l-gray-300 dark:border-t-gray-700 dark:border-l-gray-600`

const SummaryCard = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-color-primary hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className="mt-1 text-2xl font-bold">{value}</p>
  </div>
)

const HelpButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-amber-500 transition-colors hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
    title="O que é o furo?"
    aria-label="O que é o furo?"
  >
    <HelpCircle size={14} />
  </button>
)

/** Quantidade de cores (--color-1 .. --color-N) alternadas entre os cards, por id do consórcio. */
const CARD_ACCENT_COUNT = 5

/** Linha de células separadas por divisores nítidos (mesmo modelo dos painéis da Home). */
const CELL_ROW_CLS =
  'grid grid-cols-1 divide-y divide-gray-300 dark:divide-gray-600 sm:divide-x sm:divide-y-0 lg:divide-x lg:divide-y-0'

const CardValue = ({
  label,
  value,
  hint,
  sub,
  sub2,
  onHelp,
  large,
}: {
  label: string
  value: ReactNode
  hint?: string
  sub?: string
  sub2?: string
  onHelp?: () => void
  large?: boolean
}) => (
  <div className="min-w-0 bg-white px-5 py-4 dark:bg-gray-800">
    <p
      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      title={hint}
    >
      {label}
      {onHelp ? <HelpButton onClick={onHelp} /> : null}
    </p>
    <p className={`mt-1 truncate font-bold text-gray-900 dark:text-gray-100 ${large ? 'text-2xl' : 'text-lg'}`}>{value}</p>
    {sub ? <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p> : null}
    {sub2 ? <p className="text-xs text-gray-500 dark:text-gray-400">{sub2}</p> : null}
  </div>
)

const ConsortiumCard = ({
  c,
  onOpen,
  onEdit,
  onToggleStatus,
  onDelete,
  onHelpFuro,
  onProject,
  onExport,
}: {
  c: Consortium
  onOpen: () => void
  onEdit: () => void
  onToggleStatus: () => void
  onDelete: () => void
  onHelpFuro: () => void
  onProject: () => void
  onExport: () => void
}) => {
  const progress = c.plan_term_months > 0 ? Math.min(100, (c.paid_installments / c.plan_term_months) * 100) : 0
  const accent = `var(--color-${(c.id % CARD_ACCENT_COUNT) + 1})`
  return (
    <article
      className={`${listPageTableSectionCls} shadow-md transition-all hover:border-color-primary hover:shadow-lg ${c.is_closed ? 'opacity-80' : ''}`}
    >
      <div
        className="flex flex-wrap items-start justify-between gap-3 border-b border-l-4 border-gray-300 px-5 py-4 dark:border-gray-600"
        style={{ borderLeftColor: accent }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CompanyMark company={c.company} />
            <span className="font-semibold text-gray-900 dark:text-white">{c.company_label}</span>
            <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
              Grupo {c.group_code} · Cota {c.quota}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-sm font-medium ${SEGMENT_BADGE_CLS[c.segment] ?? SEGMENT_BADGE_FALLBACK_CLS}`}
            >
              {c.segment_label}
            </span>
            {c.is_closed && (
              <span className="rounded bg-gray-600 px-2 py-0.5 text-sm font-medium text-white">
                {c.auto_closed ? 'Quitado' : 'Encerrado'}
              </span>
            )}
          </div>
          {c.asset_description && (
            <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400" title={c.asset_description}>
              {c.asset_description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onOpen} className={reportRowActionBtnClass(true)} title="Ver detalhes">
            <Eye size={18} />
          </button>
          <button type="button" onClick={onProject} className={reportRowActionBtnClass(true)} title="Projeções">
            <TrendingUp size={18} />
          </button>
          <button type="button" onClick={onExport} className={reportRowActionBtnClass(true)} title="Exportar">
            <Download size={18} />
          </button>
          <button type="button" onClick={onEdit} className={reportRowActionBtnClass(true)} title="Editar">
            <Pencil size={18} />
          </button>
          {!c.auto_closed && (
            <button
              type="button"
              onClick={onToggleStatus}
              className={reportRowActionBtnClass(true)}
              title={c.is_closed ? 'Reabrir' : 'Encerrar'}
            >
              {c.is_closed ? <Unlock size={18} /> : <Lock size={18} />}
            </button>
          )}
          <button type="button" onClick={onDelete} className={reportRowActionBtnClass(true, 'danger')} title="Excluir">
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="border-b border-gray-300 px-5 py-3 dark:border-gray-600">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
            <span>
              Pagas <strong className="text-gray-900 dark:text-gray-100">{c.paid_installments}/{c.plan_term_months}</strong>
            </span>
            <span>
              Restantes <strong className="text-gray-900 dark:text-gray-100">{c.remaining_installments}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              Furo <strong className="text-gray-900 dark:text-gray-100">{c.catch_up_installments}</strong>
              <HelpButton onClick={onHelpFuro} />
            </span>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: accent }} />
        </div>
      </div>

      <div className={`${CELL_ROW_CLS} sm:grid-cols-3`}>
        <CardValue label="Crédito" value={money(c.credit_amount)} large />
        <CardValue label="Total pago" value={money(c.total_paid)} sub={pct(c.paid_pct)} large />
        <CardValue label="Saldo devedor" value={money(c.outstanding_balance)} sub={pct(c.to_collect_pct)} large />
      </div>

      <div className={`${CELL_ROW_CLS} border-t border-gray-300 dark:border-gray-600 lg:grid-cols-4`}>
        <CardValue
          label="Parcela"
          value={money(c.monthly_amount)}
          sub={`Reajuste em ${date(c.next_adjustment_date)}`}
          sub2={`Redução ${c.reduction_factor != null ? pct(c.reduction_factor) : '—'}`}
        />
        <CardValue label="Próx. vencimento" value={date(c.next_due_date)} />
        <CardValue label="Parcela furo" value={money(c.catch_up_installment_amount)} onHelp={onHelpFuro} />
        <CardValue label="Total furo" value={money(catchUpTotal(c))} hint="Qtde de furo × parcela furo" />
      </div>
    </article>
  )
}

const ConsorciosPage = () => {
  const [items, setItems] = useState<Consortium[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<(Consortium & { installments: Installment[] }) | null>(null)

  useEffect(() => {
    axios
      .get<Consortium[]>('/api/consortiums')
      .then((res) => setItems(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Erro ao carregar consórcios'))
      .finally(() => setLoading(false))
  }, [])

  const open = async (id: number) => {
    try {
      const res = await axios.get(`/api/consortiums/${id}`)
      setSelected(res.data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao abrir consórcio')
    }
  }
  const [projecting, setProjecting] = useState<Consortium | null>(null)
  const closeProjection = useCallback(() => setProjecting(null), [])
  const [showFuroHelp, setShowFuroHelp] = useState(false)
  const closeFuroHelp = useCallback(() => setShowFuroHelp(false), [])
  useEscapeKey(closeFuroHelp, showFuroHelp)

  const [listTab, setListTab] = useState<'open' | 'closed'>('open')
  const [searchTerm, setSearchTerm] = useState('')

  const openItems = items.filter((c) => !c.is_closed)
  const closedItems = items.filter((c) => c.is_closed)
  const term = searchTerm.trim().toLowerCase()
  const displayItems = (listTab === 'open' ? openItems : closedItems).filter(
    (c) =>
      !term ||
      [c.company_label, c.group_code, c.quota, c.asset_description, c.segment_label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
  )
  // Os totais consideram apenas os consórcios abertos.
  const sumOf = (pick: (c: Consortium) => number | null | undefined) =>
    openItems.reduce((sum, c) => sum + Number(pick(c) || 0), 0)
  const totals = {
    credit: sumOf((c) => c.credit_amount),
    monthly: sumOf((c) => c.monthly_amount),
    balance: sumOf((c) => c.outstanding_balance),
    catchUp: sumOf((c) => catchUpTotal(c)),
  }

  const { showConfirm, ConfirmComponent } = useConfirm()
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success',
  })
  const exportRunner = useExportRunner((message) => setToast({ show: true, message, type: 'error' }))

  const handleDelete = (c: Consortium) => {
    showConfirm(
      'Excluir consórcio',
      `Excluir ${c.company_label} · Grupo ${c.group_code} · Cota ${c.quota}?\n\nO consórcio e todos os seus lançamentos serão removidos. Esta ação não pode ser desfeita.`,
      async () => {
        try {
          await axios.delete(`/api/consortiums/${c.id}`)
          setItems((prev) => prev.filter((item) => item.id !== c.id))
          setToast({ show: true, message: 'Consórcio excluído com sucesso!', type: 'success' })
        } catch (err: any) {
          setToast({ show: true, message: err.response?.data?.detail || 'Erro ao excluir consórcio', type: 'error' })
        }
      },
      'Excluir',
      'Cancelar',
    )
  }

  const handleToggleStatus = (c: Consortium) => {
    const reopening = c.is_closed
    showConfirm(
      reopening ? 'Reabrir consórcio' : 'Encerrar consórcio',
      reopening
        ? `Reabrir ${c.company_label} · Grupo ${c.group_code} · Cota ${c.quota}?\n\nEle volta para a aba "Abertos".`
        : `Encerrar ${c.company_label} · Grupo ${c.group_code} · Cota ${c.quota}?\n\nEle será movido para a aba "Fechados". Uma nova importação do extrato o reabre.`,
      async () => {
        try {
          const res = await axios.patch<Consortium>(`/api/consortiums/${c.id}/status`, { active: reopening })
          setItems((prev) => prev.map((item) => (item.id === c.id ? { ...item, ...res.data } : item)))
          setToast({ show: true, message: reopening ? 'Consórcio reaberto!' : 'Consórcio encerrado!', type: 'success' })
        } catch (err: any) {
          setToast({ show: true, message: err.response?.data?.detail || 'Erro ao alterar o status', type: 'error' })
        }
      },
      reopening ? 'Reabrir' : 'Encerrar',
      'Cancelar',
    )
  }

  const [editing, setEditing] = useState<Consortium | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editReduction, setEditReduction] = useState('')
  const [saving, setSaving] = useState(false)

  const openEdit = (c: Consortium) => {
    setEditing(c)
    setEditReduction(c.reduction_factor != null ? String(Math.round(c.reduction_factor * 100)) : '')
    setEditAmount(
      // Gravado negativo (despesa); o campo trabalha com o valor positivo.
      c.catch_up_installment_amount != null ? String(Math.round(Math.abs(c.catch_up_installment_amount) * 100)) : '',
    )
  }
  const closeEdit = useCallback(() => setEditing(null), [])
  useEscapeKey(closeEdit, !!editing && !saving)

  const handleSaveEdit = async () => {
    if (!editing) return
    const amount = editAmount === '' ? null : parseInt(editAmount, 10) / 100
    const payload = {
      catch_up_installment_amount: amount,
      reduction_factor: editReduction === '' ? null : parseInt(editReduction, 10) / 100,
    }
    setSaving(true)
    try {
      const res = await axios.put<Consortium>(`/api/consortiums/${editing.id}`, payload)
      setItems((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...res.data } : item)))
      setSelected((prev) => (prev && prev.id === editing.id ? { ...prev, ...res.data } : prev))
      setEditing(null)
      setToast({ show: true, message: 'Consórcio atualizado com sucesso!', type: 'success' })
    } catch (err: any) {
      setToast({ show: true, message: err.response?.data?.detail || 'Erro ao salvar consórcio', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  const scrollToTop = useCallback(() => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => setShowBackToTop(container.scrollTop > 300)
    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loading, items.length])

  const close = useCallback(() => setSelected(null), [])
  useEscapeKey(close, !!selected)

  const totalPaid = selected
    ? selected.installments.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
    : 0
  const estimate = selected ? estimateTotalCost(selected, totalPaid) : null

  const buildDetailsExport = (selected: Consortium & { installments: Installment[] }): ConsortiumDetailsExport => {
    const totalPaid = selected.installments.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
    const estimate = estimateTotalCost(selected, totalPaid)
    const text = (v?: number | null) => (v == null ? '—' : formatCurrency(v))
    const furoTotal = catchUpTotal(selected)
    return {
      title: `${selected.company_label} · Grupo ${selected.group_code} · Cota ${selected.quota}`,
      subtitle: [selected.segment_label, selected.asset_description, selected.contract_number && `Contrato ${selected.contract_number}`]
        .filter(Boolean)
        .join(' · '),
      sections: [
        {
          title: 'Resumo',
          fields: [
            { label: 'Prazo', value: `${selected.plan_term_months} meses` },
            { label: 'Entrada no grupo', value: date(selected.joined_date) },
            { label: 'Último vencimento', value: date(selected.last_due_date) },
            { label: 'Encerramento do grupo', value: date(selected.group_end_date) },
          ],
        },
        {
          title: 'Valores',
          fields: [
            { label: 'Crédito', value: text(selected.credit_amount) },
            { label: 'Total pago (líquido)', value: `${text(totalPaid)} (${pct(selected.paid_pct)})` },
            { label: 'Saldo devedor', value: `${text(selected.outstanding_balance)} (${pct(selected.to_collect_pct)})` },
            {
              label: 'Total estimado a pagar',
              value: estimate ? `${text(estimate.total)} · juros ${pct(estimate.totalPct)} · ${pct(estimate.annualPct)} a.a.` : '—',
            },
          ],
        },
        {
          title: 'Parcelas',
          fields: [
            { label: 'Pagas', value: `${selected.paid_installments} de ${selected.plan_term_months}` },
            {
              label: 'Restantes',
              value: `${selected.remaining_installments} (${selected.open_regular_installments} regulares + ${selected.catch_up_installments} furo)`,
            },
            { label: 'Próx. vencimento', value: date(selected.next_due_date) },
            {
              label: 'Regulares em aberto',
              value: `${selected.open_regular_installments} · parcela ${text(selected.monthly_amount)} · redução ${selected.reduction_factor != null ? pct(selected.reduction_factor) : 'não informada'}`,
            },
            {
              label: 'Furo',
              value: `${selected.catch_up_installments} · parcela ${text(selected.catch_up_installment_amount)} · total ${text(furoTotal)}`,
            },
          ],
        },
        {
          title: 'Taxas e reajuste',
          fields: [
            { label: 'Taxa de administração', value: pct(selected.admin_fee_pct) },
            { label: 'Fundo de reserva', value: pct(selected.reserve_fund_pct) },
            { label: 'Seguro', value: pct(selected.insurance_pct) },
            { label: 'Próx. reajuste', value: date(selected.next_adjustment_date) },
          ],
        },
        {
          title: 'Andamento',
          fields: [
            { label: '% em atraso', value: pct(selected.pending_pct) },
            { label: '% ideal pago', value: pct(selected.ideal_paid_pct) },
            { label: 'Diferença', value: pct(selected.diff_pct) },
          ],
        },
      ],
      installments: selected.installments.map((r) => ({
        number: r.installment_number ?? null,
        description: r.entry_description,
        due: date(r.due_date),
        paidOn: date(r.payment_date),
        amountDue: r.amount_due ?? null,
        amountPaid: r.amount_paid ?? null,
        fine: r.fine_amount ?? null,
        interest: r.interest_amount ?? null,
      })),
    }
  }

  const [exportTarget, setExportTarget] = useState<Consortium | null>(null)
  const [exportChartRows, setExportChartRows] = useState<ProjectionChartRow[] | null>(null)
  const exportParcelChartRef = useRef<HTMLDivElement>(null)
  const exportBalanceChartRef = useRef<HTMLDivElement>(null)

  const [exportPremises, setExportPremises] = useState<{
    contemplationYm: number
    rate: string
    reduction: string
    furo: string
  } | null>(null)
  const [exportIncludeProjection, setExportIncludeProjection] = useState(false)
  const exportBase = exportTarget ? buildBase(exportTarget) : null

  /** Abre o modal de exportação já com as premissas iniciais da projeção preenchidas. */
  const openExport = (c: Consortium) => {
    const initial = defaultProjectionPremises(c)
    setExportPremises(
      initial
        ? {
            contemplationYm: initial.contemplationYm,
            rate: String(initial.ratePct),
            reduction: String(initial.reductionPct),
            // Em centavos (dígitos), como o campo mascarado.
            furo: initial.furoTotal ? String(Math.round(initial.furoTotal * 100)) : '',
          }
        : null,
    )
    setExportIncludeProjection(false)
    setExportTarget(c)
  }

  /** Detalhes + parcelas + projeção (com as premissas preenchidas no modal) no mesmo arquivo. */
  const handleExportConsortium = (format: 'pdf' | 'excel') => {
    const target = exportTarget
    if (!target) return
    const parse = (value: string) => {
      const n = parseFloat(value.replace(',', '.'))
      return Number.isFinite(n) ? n : 0
    }
    // O Excel sempre traz a projeção (as premissas são editadas dentro da planilha); o PDF só se marcado.
    const includeProjection = format === 'excel' || exportIncludeProjection
    const premises: ProjectionPremises | undefined = format === 'pdf' && exportPremises
      ? {
          contemplationYm: exportPremises.contemplationYm,
          ratePct: parse(exportPremises.rate),
          reductionPct: parse(exportPremises.reduction),
          furoTotal: parseInt(exportPremises.furo || '0', 10) / 100,
        }
      : undefined
    void exportRunner.run(format === 'pdf' ? 'Gerando PDF…' : 'Gerando Excel…', async () => {
      const res = await axios.get<Consortium & { installments: Installment[] }>(`/api/consortiums/${target.id}`)
      const details = buildDetailsExport(res.data)
      const built = includeProjection ? buildProjectionExport(res.data, premises) : null
      const projection = built?.data ?? null
      if (format === 'excel') {
        await exportConsortiumExcel(details, projection)
        return
      }
      if (built && projection) {
        setExportChartRows(built.chartRows)
        try {
          await new Promise((resolve) => setTimeout(resolve, 400))
          const root = getComputedStyle(document.documentElement)
          const color = (cssVar: string) => root.getPropertyValue(cssVar.replace(/^var\((--[\w-]+)\)$/, '$1')).trim() || '#6b7280'
          projection.legend = [
            { name: 'Ao final', color: color(EXPORT_CHART_COLORS.end) },
            { name: 'Contemplado', color: color(EXPORT_CHART_COLORS.contemplated) },
          ]
          projection.charts = [
            { title: 'Valor da parcela por mês', image: await captureChartImage(exportParcelChartRef.current) },
            {
              title: 'Saldo devedor projetado (após pagar a parcela do mês)',
              image: await captureChartImage(exportBalanceChartRef.current),
            },
          ]
        } finally {
          setExportChartRows(null)
        }
      }
      await exportConsortiumPdf(details, projection)
    })
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Handshake className="h-8 w-8" />}
              title="Consórcios"
              subtitle="Consórcios importados dos extratos das administradoras."
            />
          }
        >
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
          {loading ? (
            <CadastroListPageLoading />
          ) : items.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Handshake size={32} />}
              title="Nenhum consórcio importado"
              description="Importe o extrato em PDF pela tela de importação."
            />
          ) : (
            <div className={`space-y-4 ${showBackToTop ? 'pb-20' : ''}`}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryCard label="Total de crédito" value={money(totals.credit)} />
                <SummaryCard label="Parcelas por mês" value={money(totals.monthly)} />
                <SummaryCard label="Saldo devedor" value={money(totals.balance)} />
                <SummaryCard label="Total furo" value={money(totals.catchUp)} />
              </div>

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="px-4 pt-3">
                  <CadastroListPageTabs
                    tabs={[
                      { key: 'open', label: 'Abertos', icon: <Clock size={16} />, count: openItems.length },
                      { key: 'closed', label: 'Fechados', icon: <CheckCircle size={16} />, count: closedItems.length },
                    ]}
                    active={listTab}
                    onChange={setListTab}
                    trailing={
                      <div className="w-72">
                        <CadastroListPageSearchField
                          value={searchTerm}
                          onChange={setSearchTerm}
                          placeholder="Buscar por grupo, cota ou bem…"
                        />
                      </div>
                    }
                  />
                </div>
                <div className="space-y-6 p-6">
                  {displayItems.length === 0 ? (
                    <div className="py-8 text-center">
                      <Handshake className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {listTab === 'open' ? 'Nenhum consórcio aberto neste filtro' : 'Nenhum consórcio fechado neste filtro'}
                      </p>
                    </div>
                  ) : (
                    displayItems.map((c, i) => (
                      <Fragment key={c.id}>
                        {i > 0 && (
                          <div className="flex items-center gap-3" aria-hidden>
                            <span className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                            <span className="h-px flex-1 bg-gray-300 dark:bg-gray-600" />
                          </div>
                        )}
                        <ConsortiumCard
                          c={c}
                          onOpen={() => void open(c.id)}
                          onEdit={() => openEdit(c)}
                          onToggleStatus={() => handleToggleStatus(c)}
                          onDelete={() => handleDelete(c)}
                          onHelpFuro={() => setShowFuroHelp(true)}
                          onProject={() => setProjecting(c)}
                          onExport={() => openExport(c)}
                        />
                      </Fragment>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {showBackToTop && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={scrollToTop}
              className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}

      {selected && (
        <CadastroModalShell maxWidth="max-w-5xl">
          <CadastroModalHeader
            isEdit={false}
            title={`${selected.company_label} · Grupo ${selected.group_code} · Cota ${selected.quota}`}
            subtitle={selected.asset_description || selected.segment_label}
            icon={<Handshake size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
            onClose={close}
          />
          <CadastroModalBody>
            {(
              <>
                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 first:mt-0 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <CompanyMark company={selected.company} />
                    <span className="font-semibold text-gray-900 dark:text-white">{selected.company_label}</span>
                    <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
                      Grupo {selected.group_code} · Cota {selected.quota}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-sm font-medium ${SEGMENT_BADGE_CLS[selected.segment] ?? SEGMENT_BADGE_FALLBACK_CLS}`}
                    >
                      {selected.segment_label}
                    </span>
                    {selected.is_closed && (
                      <span className="rounded bg-gray-600 px-2 py-0.5 text-sm font-medium text-white">
                        {selected.auto_closed ? 'Quitado' : 'Encerrado'}
                      </span>
                    )}
                    {selected.contract_number && (
                      <span className="ml-auto text-sm tabular-nums text-gray-500 dark:text-gray-400">
                        Contrato {selected.contract_number}
                      </span>
                    )}
                  </div>
                  {selected.asset_description && (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{selected.asset_description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
                    <MiniInfo label="Prazo" value={`${selected.plan_term_months} meses`} />
                    <MiniInfo label="Entrada no grupo" value={date(selected.joined_date)} />
                    <MiniInfo label="Último vencimento" value={date(selected.last_due_date)} />
                    <MiniInfo label="Encerramento do grupo" value={date(selected.group_end_date)} />
                  </div>
                </div>

                <CadastroFormSection title="Valores" icon={<Wallet size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={4}>
                      <Field label="Crédito" value={money(selected.credit_amount)} />
                      <Field
                        label="Total pago (líquido)"
                        value={
                          <span className="flex items-baseline gap-2">
                            {money(totalPaid)}
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{pct(selected.paid_pct)}</span>
                          </span>
                        }
                      />
                      <Field
                        label="Saldo devedor"
                        value={
                          <span className="flex items-baseline gap-2">
                            {money(selected.outstanding_balance)}
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{pct(selected.to_collect_pct)}</span>
                          </span>
                        }
                      />
                      <Field
                        label="Total estimado a pagar"
                        value={
                          estimate ? (
                            <span
                              className="flex flex-col"
                              title="Total pago + saldo devedor (hoje). Juros total = custo ÷ crédito − 1. Juros anual = juros total ÷ (prazo em meses ÷ 12)."
                            >
                              {money(estimate.total)}
                              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                juros {pct(estimate.totalPct)} · {pct(estimate.annualPct)} a.a.
                              </span>
                            </span>
                          ) : (
                            '—'
                          )
                        }
                      />
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Parcelas" icon={<CalendarDays size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={3}>
                      <Field label="Pagas" value={`${selected.paid_installments} de ${selected.plan_term_months}`} />
                      <Field
                        label="Restantes"
                        value={
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            {selected.remaining_installments}
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              ({selected.open_regular_installments} regulares + {selected.catch_up_installments} furo)
                            </span>
                          </span>
                        }
                      />
                      <Field label="Próx. vencimento" value={date(selected.next_due_date)} />
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow cols={2}>
                      <Field
                        label="Regulares em aberto"
                        value={
                          <span className="flex flex-col">
                            {selected.open_regular_installments}
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              parcela {money(selected.monthly_amount)} · redução{' '}
                              {selected.reduction_factor != null ? pct(selected.reduction_factor) : 'não informada'}
                            </span>
                          </span>
                        }
                      />
                      <Field
                        label="Furo"
                        value={
                          <span className="flex flex-col">
                            {selected.catch_up_installments}
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              parcela {money(selected.catch_up_installment_amount)} · total {money(catchUpTotal(selected))}
                            </span>
                          </span>
                        }
                      />
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Taxas e reajuste" icon={<Percent size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={4}>
                      <Field label="Taxa de administração" value={pct(selected.admin_fee_pct)} />
                      <Field label="Fundo de reserva" value={pct(selected.reserve_fund_pct)} />
                      <Field label="Seguro" value={pct(selected.insurance_pct)} />
                      <Field label="Próx. reajuste" value={date(selected.next_adjustment_date)} />
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Andamento" icon={<TrendingUp size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={3}>
                      <Field label="% em atraso" value={pct(selected.pending_pct)} />
                      <Field label="% ideal pago" value={pct(selected.ideal_paid_pct)} />
                      <Field label="Diferença" value={pct(selected.diff_pct)} />
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Lançamentos" icon={<FileText size={14} />} bodyClassName="p-0">
                  <table className="w-full table-auto">
                    <thead className={reportTableChromeHeaderCls}>
                      <tr>
                        <th className={`${REPORT_TH} text-left`}>Parcela</th>
                        <th className={`${REPORT_TH} text-left`}>Lançamento</th>
                        <th className={`${REPORT_TH} text-left`}>Vencimento</th>
                        <th className={`${REPORT_TH} text-left`}>Pagamento</th>
                        <th className={`${REPORT_TH} text-right`}>Devido</th>
                        <th className={`${REPORT_TH} text-right`}>Pago</th>
                        <th className={`${REPORT_TH} text-right`}>Multa</th>
                        <th className={`${REPORT_TH} text-right`}>Juros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.installments.map((r) => (
                        <tr
                          key={r.id}
                          className={REPORT_ROW}
                          onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                        >
                          <td className="px-3 py-4 text-left text-sm text-gray-500 whitespace-nowrap dark:text-gray-400">{r.installment_number ?? '—'}</td>
                          <td className="px-3 py-4 text-left text-sm text-gray-800 dark:text-gray-100">{r.entry_description}</td>
                          <td className="px-3 py-4 text-left text-sm text-gray-700 whitespace-nowrap dark:text-gray-300">{date(r.due_date)}</td>
                          <td className="px-3 py-4 text-left text-sm text-gray-700 whitespace-nowrap dark:text-gray-300">{date(r.payment_date)}</td>
                          <td className="px-3 py-4 text-right text-sm tabular-nums whitespace-nowrap">{money(r.amount_due)}</td>
                          <td className="px-3 py-4 text-right text-sm font-semibold tabular-nums whitespace-nowrap">{money(r.amount_paid)}</td>
                          <td className="px-3 py-4 text-right text-sm tabular-nums whitespace-nowrap">{money(r.fine_amount)}</td>
                          <td className="px-3 py-4 text-right text-sm tabular-nums whitespace-nowrap">{money(r.interest_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className={`${listPageTableChromeFooterCls} text-sm text-gray-600 dark:text-gray-400`}>
                            {selected.installments.length} {selected.installments.length === 1 ? 'lançamento' : 'lançamentos'}
                          </div>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </CadastroFormSection>
              </>
            )}
          </CadastroModalBody>
          <CadastroModalFooter onClose={close} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      )}

      {editing && (
        <CadastroModalShell maxWidth="max-w-md">
          <CadastroModalHeader
            isEdit
            title="Editar consórcio"
            subtitle={`${editing.company_label} · Grupo ${editing.group_code} · Cota ${editing.quota}`}
            icon={<Handshake size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
            onClose={closeEdit}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Furo (catch up)" icon={<Handshake size={14} />}>
              <CadastroFieldLabel>Parcela furo</CadastroFieldLabel>
              <div className="relative mt-0.5">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-gray-400">
                  R$
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editAmount ? `-${formatAmountMask(editAmount)}` : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10)
                    setEditAmount(digits)
                  }}
                  placeholder="-0,00"
                  autoFocus
                  disabled={saving}
                  className={`${cadastroFieldCls} pl-10 font-semibold disabled:opacity-50 ${
                    editAmount ? 'text-red-600 dark:text-red-400' : ''
                  }`}
                />
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                Não vem no extrato. O valor informado é mantido nas reimportações.
              </p>
            </CadastroFormSection>

            <CadastroFormSection title="Redução da parcela" icon={<Percent size={14} />}>
              <CadastroFieldLabel>Fator de redução</CadastroFieldLabel>
              <div className="relative mt-0.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={editReduction ? formatAmountMask(editReduction) : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 5)
                    setEditReduction(digits && parseInt(digits, 10) > 10000 ? '10000' : digits)
                  }}
                  placeholder="0,00"
                  disabled={saving}
                  className={`${cadastroFieldCls} pr-10 font-semibold disabled:opacity-50`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-gray-400">
                  %
                </span>
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                Indica se a parcela está reduzida (0 a 100%). Não vem no extrato; deixe vazio se não houver redução.
              </p>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeEdit} onSave={() => void handleSaveEdit()} saving={saving} />
        </CadastroModalShell>
      )}

      {projecting && <ConsortiumProjectionModal consortium={projecting} onClose={closeProjection} />}

      {showFuroHelp && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={false}
            title="O que é o furo?"
            subtitle="Parcelas de entrada tardia no grupo (catch up)"
            icon={<HelpCircle size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
            onClose={closeFuroHelp}
          />
          <CadastroModalBody>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>
                O <strong>furo</strong> são as parcelas de um grupo que já tinha começado quando você entrou. Elas
                ficam "atrasadas" em relação ao grupo e precisam ser pagas depois, em geral quando a cota for
                contemplada ou ao final do plano.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Furo:</strong> a quantidade de parcelas de entrada tardia. Vem do extrato (Qtde Furo).
                </li>
                <li>
                  <strong>Parcela furo:</strong> o valor de cada parcela do furo. Não vem no extrato; você informa em
                  Editar. É sempre uma despesa (negativa).
                </li>
                <li>
                  <strong>Total furo:</strong> quantidade de furo × parcela furo.
                </li>
              </ul>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Na Porto Seguro o furo é sempre 0. Na Rodobens vem do extrato.
              </p>
            </div>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeFuroHelp} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      )}

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        />
      )}

      <ConfirmComponent />
      {exportRunner.overlay}
      <ExportClosureModal
        isOpen={exportTarget !== null}
        onClose={() => setExportTarget(null)}
        title="Exportar consórcio"
        subtitle="Detalhes, parcelas e projeção no mesmo arquivo"
        hideAbsoluteOption
        closeOnBackdrop={false}
        maxWidth="max-w-xl"
        summary={
          exportTarget && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                <CompanyMark company={exportTarget.company} />
                <span className="font-semibold text-gray-900 dark:text-white">{exportTarget.company_label}</span>
                <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
                  Grupo {exportTarget.group_code} · Cota {exportTarget.quota}
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-sm font-medium ${SEGMENT_BADGE_CLS[exportTarget.segment] ?? SEGMENT_BADGE_FALLBACK_CLS}`}
                >
                  {exportTarget.segment_label}
                </span>
              </div>
              {exportTarget.asset_description && (
                <p className="mt-1 truncate text-sm text-gray-600 dark:text-gray-300" title={exportTarget.asset_description}>
                  {exportTarget.asset_description}
                </p>
              )}
            </div>
          )
        }
        onExport={(format) => handleExportConsortium(format)}
      >
        {/* No Excel a projeção já vem completa e editável dentro da planilha; só o PDF pede as premissas. */}
        {(format) =>
          format === 'pdf' && exportBase && exportPremises ? (
          <CadastroFormSection title="Projeção" icon={<TrendingUp size={14} />} bodyClassName="p-0">
            <CadastroModalFieldsGrid>
              <CadastroModalFieldsRow>
                <label className={cadastroOptionLabelCls}>
                  <input
                    type="checkbox"
                    checked={exportIncludeProjection}
                    onChange={(e) => setExportIncludeProjection(e.target.checked)}
                    className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                  />
                  <span className="text-sm font-medium">Adicionar projeção</span>
                </label>
              </CadastroModalFieldsRow>
              <CadastroModalFieldsRow className={exportIncludeProjection ? '' : 'opacity-50'}>
                <div className="min-w-0">
                  <CadastroFieldLabel>Contemplação em</CadastroFieldLabel>
                  <div className="mt-1.5">
                    <MonthPicker
                      disabled={!exportIncludeProjection}
                      value={exportPremises.contemplationYm}
                      min={exportBase.firstYm}
                      max={exportBase.firstYm + exportBase.remaining - 1}
                      onChange={(ym) => setExportPremises((prev) => (prev ? { ...prev, contemplationYm: ym } : prev))}
                    />
                  </div>
                </div>
              </CadastroModalFieldsRow>
              <CadastroModalFieldsRow cols={2} className={exportIncludeProjection ? '' : 'opacity-50'}>
                <div className="min-w-0">
                  <CadastroFieldLabel>Correção anual (% a.a.)</CadastroFieldLabel>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    disabled={!exportIncludeProjection}
                    value={exportPremises.rate}
                    onChange={(e) => setExportPremises((prev) => (prev ? { ...prev, rate: e.target.value } : prev))}
                    className={`${cadastroFieldCls} mt-1.5`}
                  />
                </div>
                <div className="min-w-0">
                  <CadastroFieldLabel>Fator de redução (%)</CadastroFieldLabel>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={!exportIncludeProjection}
                    value={exportPremises.reduction}
                    onChange={(e) => setExportPremises((prev) => (prev ? { ...prev, reduction: e.target.value } : prev))}
                    className={`${cadastroFieldCls} mt-1.5`}
                  />
                </div>
              </CadastroModalFieldsRow>
              <CadastroModalFieldsRow className={exportIncludeProjection ? '' : 'opacity-50'}>
                <div className="min-w-0">
                  <CadastroFieldLabel>Total furo (R$)</CadastroFieldLabel>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={!exportIncludeProjection}
                    value={exportPremises.furo ? formatAmountMask(exportPremises.furo) : ''}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10)
                      setExportPremises((prev) => (prev ? { ...prev, furo: digits } : prev))
                    }}
                    placeholder="0,00"
                    className={`${cadastroFieldCls} mt-1.5`}
                  />
                </div>
              </CadastroModalFieldsRow>
            </CadastroModalFieldsGrid>
          </CadastroFormSection>
          ) : null
        }
      </ExportClosureModal>
      {exportChartRows && (
        <ConsortiumExportCharts rows={exportChartRows} parcelRef={exportParcelChartRef} balanceRef={exportBalanceChartRef} />
      )}
    </div>
  )
}

export default ConsorciosPage
