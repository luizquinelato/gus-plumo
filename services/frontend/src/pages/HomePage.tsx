import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPrimaryButton,
  CadastroListPageShell,
  listPageTableSectionCls,
} from '../components/CadastroListPageLayout'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  Upload,
  TrendingUp,
  TrendingDown,
  Gift,
  Landmark,
  Home,
  Eye,
  EyeOff,
  CreditCard,
  Receipt,
  History,
  Scale,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react'
import {
  formatSignedCurrencySafe,
  formatCurrency,
  MASKED_CURRENCY,
} from '../utils/currency'
import { formatDateBR } from '../utils/dateUtils'
import { useBalanceVisibility } from '../contexts/BalanceVisibilityContext'

interface ExecutiveFlowBlock {
  period_label: string
  year_month: string
  current_balance?: number | null
  opening_balance?: number | null
  entries: number
  exits: number
  net: number
  entries_count: number
  exits_count: number
  last_transaction_date?: string | null
}

interface CreditCardExecutiveBlock {
  last_invoice_year_month?: string | null
  last_invoice_label?: string | null
  last_invoice_total: number
  last_invoice_count: number
  average_invoice_total: number
  average_sample_months: number
}

interface HomeExecutiveSummary {
  period_label: string
  year_month: string
  bank: ExecutiveFlowBlock
  benefit: ExecutiveFlowBlock
  credit_card: CreditCardExecutiveBlock
}

const MONTH_NAMES_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

type LucideIcon = typeof TrendingUp

function heroAmount(hidden: boolean, value: number, mode: 'signed' | 'inflow' | 'outflow' = 'signed') {
  const valueCls = 'text-xl font-bold tabular-nums tracking-tight text-white sm:text-2xl lg:text-[1.75rem]'
  if (hidden) {
    return <span className={`${valueCls} tracking-widest text-white/45`}>{MASKED_CURRENCY}</span>
  }
  if (mode === 'outflow') {
    const abs = formatCurrency(Math.abs(value))
    return (
      <span className={valueCls}>
        {value === 0 ? formatCurrency(0) : `−${abs}`}
      </span>
    )
  }
  if (mode === 'inflow') {
    return <span className={valueCls}>{formatCurrency(Math.abs(value))}</span>
  }
  return <span className={valueCls}>{formatCurrency(value)}</span>
}

function HeroMetric({
  label,
  icon: Icon,
  hidden,
  amount,
  mode = 'signed',
  foot,
}: {
  label: string
  icon: LucideIcon
  hidden: boolean
  amount: number
  mode?: 'signed' | 'inflow' | 'outflow'
  foot?: string
}) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={14} className="shrink-0 text-white/75" />
        <span className="text-xs font-medium uppercase tracking-wide text-white/70">{label}</span>
      </div>
      <div>{heroAmount(hidden, amount, mode)}</div>
      {foot ? <p className="mt-0.5 text-[11px] text-white/50">{foot}</p> : null}
    </div>
  )
}

function PanelHeader({
  accentVar,
  icon,
  title,
  subtitle,
}: {
  accentVar: string
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div
      className="flex items-start gap-3 border-b border-l-4 border-gray-200 px-5 py-4 dark:border-gray-600"
      style={{ borderLeftColor: accentVar }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-[color-mix(in_srgb,var(--color-1)_20%,transparent)]"
        style={{
          color: accentVar,
          background: `color-mix(in srgb, ${accentVar} 14%, transparent)`,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  )
}

function PanelCell({
  label,
  icon,
  value,
  hint,
  large,
}: {
  label: string
  icon: ReactNode
  value: ReactNode
  hint?: string
  large?: boolean
}) {
  return (
    <div className="flex min-h-[7.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
      <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className={large ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}>{value}</div>
      {hint ? <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  )
}

const HomePage = () => {
  const { hideBalanceValues, toggleBalanceVisibility } = useBalanceVisibility()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<HomeExecutiveSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const now = new Date()
  const currentMonthLabel = `${MONTH_NAMES_FULL[now.getMonth()]} ${now.getFullYear()}`

  const loadSummary = async () => {
    try {
      setIsLoading(true)
      const response = await axios.get<HomeExecutiveSummary>('/api/dashboard/home')
      setSummary(response.data)
    } catch (error) {
      console.error('Erro ao carregar sumário:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  const bank = summary?.bank
  const benefit = summary?.benefit
  const credit = summary?.credit_card

  const creditInsight =
    credit && credit.average_sample_months > 0 && credit.last_invoice_total !== 0
      ? Math.abs(credit.last_invoice_total) > credit.average_invoice_total
        ? 'Última fatura acima da média histórica.'
        : Math.abs(credit.last_invoice_total) < credit.average_invoice_total
          ? 'Última fatura abaixo da média histórica.'
          : 'Última fatura alinhada à média histórica.'
      : null

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Home className="h-8 w-8" />}
              title="Plumo"
              subtitle={`Finanças leves, vida plena. · ${currentMonthLabel}`}
              actions={
                <CadastroListPrimaryButton
                  label="Importar"
                  onClick={() => navigate('/importar')}
                  icon={<Upload size={18} />}
                />
              }
            />
          }
        >
          <div className="w-full min-w-0 space-y-8 pb-8">
            {isLoading ? (
              <div className="flex items-center justify-center py-24">
                <LoadingSpinner message="Carregando dados..." />
              </div>
            ) : summary && bank ? (
              <>
                <section
                  className="relative overflow-hidden rounded-2xl p-6 shadow-lg sm:p-8"
                  style={{ background: 'var(--gradient-1-2)' }}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Landmark size={18} className="text-white/70" />
                      <span className="text-sm font-medium uppercase tracking-wide text-white/80">
                        Saldo em conta · {bank.period_label}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleBalanceVisibility}
                      className="rounded-lg bg-white/10 p-2 text-white/80 transition-all hover:bg-white/20 hover:text-white"
                      title={hideBalanceValues ? 'Exibir valores' : 'Ocultar valores'}
                    >
                      {hideBalanceValues ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  <p className="text-[clamp(2.5rem,5.5vw,3.75rem)] font-bold tabular-nums leading-none tracking-tight text-white">
                    {hideBalanceValues ? (
                      <span className="tracking-widest text-white/45">{MASKED_CURRENCY}</span>
                    ) : (
                      formatCurrency(bank.net)
                    )}
                  </p>
                  {bank.last_transaction_date ? (
                    <p className="mt-2 text-sm text-white/60">
                      Última movimentação em {formatDateBR(bank.last_transaction_date)}
                    </p>
                  ) : null}

                  <div className="mt-8 border-t border-white/20 pt-6">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/75">
                      Conta corrente · {bank.period_label}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <HeroMetric
                        label="Saldo mês anterior"
                        icon={History}
                        hidden={hideBalanceValues}
                        amount={bank.opening_balance ?? 0}
                        mode="signed"
                      />
                      <HeroMetric
                        label="Entradas"
                        icon={TrendingUp}
                        hidden={hideBalanceValues}
                        amount={bank.entries}
                        mode="inflow"
                        foot={`${bank.entries_count} lançamentos`}
                      />
                      <HeroMetric
                        label="Saídas"
                        icon={TrendingDown}
                        hidden={hideBalanceValues}
                        amount={bank.exits}
                        mode="outflow"
                        foot={`${bank.exits_count} lançamentos`}
                      />
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-2 xl:gap-8">
                  <article className={`${listPageTableSectionCls} flex flex-col overflow-hidden`}>
                    <PanelHeader
                      accentVar="var(--color-2)"
                      icon={<CreditCard size={18} />}
                      title="Cartão de crédito"
                      subtitle={
                        credit?.last_invoice_label
                          ? `Última fatura · ${credit.last_invoice_label}`
                          : 'Nenhuma fatura importada ainda'
                      }
                    />
                    <div className="grid flex-1 grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                      <PanelCell
                        label="Última fatura"
                        icon={<Receipt size={14} className="text-[var(--color-2)]" />}
                        large
                        hint={`${credit?.last_invoice_count ?? 0} lançamentos${
                          credit?.last_invoice_year_month ? ` · ref. ${credit.last_invoice_year_month}` : ''
                        }`}
                        value={formatSignedCurrencySafe(credit?.last_invoice_total ?? 0, hideBalanceValues, {
                          forceNegative: (credit?.last_invoice_total ?? 0) !== 0,
                          colorClass: 'font-bold text-[var(--color-danger)]',
                        })}
                      />
                      <PanelCell
                        label="Média histórica"
                        icon={<BarChart3 size={14} className="text-gray-600 dark:text-gray-400" />}
                        large
                        hint={
                          (credit?.average_sample_months ?? 0) === 0
                            ? 'Sem histórico de faturas'
                            : (credit?.average_sample_months ?? 0) === 1
                              ? '1 mês com fatura importada'
                              : `${credit?.average_sample_months} meses com fatura importada`
                        }
                        value={formatSignedCurrencySafe(credit?.average_invoice_total ?? 0, hideBalanceValues, {
                          forceNegative: (credit?.average_invoice_total ?? 0) !== 0,
                          colorClass: 'font-bold text-gray-900 dark:text-gray-100',
                        })}
                      />
                    </div>
                    {creditInsight ? (
                      <p className="border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                        {creditInsight}
                      </p>
                    ) : null}
                  </article>

                  <article className={`${listPageTableSectionCls} flex flex-col overflow-hidden`}>
                    <PanelHeader
                      accentVar="var(--color-3)"
                      icon={<Gift size={18} />}
                      title="Cartão benefício"
                      subtitle={`Extrato · ${benefit?.period_label ?? '—'}`}
                    />
                    <div className="grid flex-1 grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                      <PanelCell
                        label="Entradas"
                        icon={<ArrowDownLeft size={14} className="text-[var(--color-success)]" />}
                        hint={`${benefit?.entries_count ?? 0} lanç.`}
                        value={formatSignedCurrencySafe(benefit?.entries ?? 0, hideBalanceValues, {
                          colorClass: 'font-bold text-[var(--color-success)]',
                        })}
                      />
                      <PanelCell
                        label="Saídas"
                        icon={<ArrowUpRight size={14} className="text-[var(--color-danger)]" />}
                        hint={`${benefit?.exits_count ?? 0} lanç.`}
                        value={formatSignedCurrencySafe(benefit?.exits ?? 0, hideBalanceValues, {
                          forceNegative: (benefit?.exits ?? 0) !== 0,
                          colorClass: 'font-bold text-[var(--color-danger)]',
                        })}
                      />
                      <PanelCell
                        label="Saldo do período"
                        icon={<Scale size={14} className="text-[var(--color-3)]" />}
                        hint={
                          benefit?.last_transaction_date
                            ? `Até ${formatDateBR(benefit.last_transaction_date)}`
                            : 'Sem movimentação'
                        }
                        value={formatSignedCurrencySafe(benefit?.net ?? 0, hideBalanceValues, {
                          colorClass:
                            (benefit?.net ?? 0) < 0
                              ? 'font-bold text-[var(--color-danger)]'
                              : (benefit?.net ?? 0) > 0
                                ? 'font-bold text-[var(--color-success)]'
                                : 'font-bold text-gray-700 dark:text-gray-200',
                        })}
                      />
                    </div>
                  </article>
                </div>
              </>
            ) : (
              <div className={`${listPageTableSectionCls} px-6 py-12 text-center text-sm text-gray-500`}>
                Não foi possível carregar o panorama. Tente atualizar a página.
              </div>
            )}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>
    </div>
  )
}

export default HomePage
