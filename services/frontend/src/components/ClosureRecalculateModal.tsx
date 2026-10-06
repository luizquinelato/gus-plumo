import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import axios from 'axios'
import {
  AlertTriangle,
  ArrowLeftRight,
  CreditCard,
  Gift,
  GitCompare,
  Landmark,
  PlusCircle,
  RefreshCw,
  Receipt,
  Scale,
} from 'lucide-react'
import SharedAccountDisplay from './SharedAccountDisplay'
import { getSettlementCreditSignedForViewer } from '../utils/closureCreditUtils'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { CadastroListPageTabs, listPageTableSectionCls } from './CadastroListPageLayout'
import LoadingSpinner from './LoadingSpinner'
import {
  AlteredClosureItemsTable,
  ItemsTable,
  SharedClosureItemsView,
} from './SharedClosureItemsModal'
import LoanDirectionBadge from './LoanDirectionBadge'
import { aggregateRecalcMovementBySource, buildDisplayItemFromRecalcRow } from '../utils/closureRecalcDiff'
import { formatCurrency } from '../utils/currency'
import { buildAllClosureItems } from '../utils/closureItemsBuilder'
import { formatDateTimeBR } from '../utils/dateUtils'
import Badge from './Badge'

type RecalcTab = 'summary' | 'altered' | 'new' | 'removed'

export type ClosureRecalcPreview = {
  has_changes: boolean
  summary: {
    new_count: number
    removed_count: number
    altered_count: number
    tag_only_count: number
    old_net_amount: number
    new_net_amount: number
    net_delta: number
  }
  new_items: Array<{ key: string; source_label: string; source_table?: string; item: Record<string, unknown> }>
  removed_items: Array<{ key: string; source_label: string; source_table?: string; item: Record<string, unknown> }>
  altered_items: Array<{
    key: string
    source_label: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }>
  proposed_closure_data: Record<string, unknown>
  settlement: {
    is_settled: boolean
    total_paid: number
    old_remaining: number
    new_remaining: number
    auto_reopen: boolean
    requires_resolution: boolean
    overpayment_amount: number
  }
  period: { start: string; end: string; partner_account_id: number }
}

type ClosureLike = {
  id: number
  month: number
  year: number
  period_start_date: string
  closing_date: string
  closure_data?: Record<string, unknown>
}

type Props = {
  closure: ClosureLike | null
  loggedAccountId: number | null
  onClose: () => void
  onApplied: () => void
}

function formatSignedMoney(value: number) {
  if (Math.abs(value) < 0.005) return formatCurrency(0)
  return `${value < 0 ? '-' : ''}${formatCurrency(Math.abs(value))}`
}

function moneyTone(value: number) {
  if (Math.abs(value) < 0.005) return 'text-gray-900 dark:text-gray-100'
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
}

/** Mesmo padrão visual dos painéis em HomePage (PanelHeader / PanelCell). */
function RecalcDiffPanelHeader({
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

function RecalcDiffPanelCell({
  label,
  icon,
  count,
  hint,
}: {
  label: string
  icon: ReactNode
  count: number
  hint?: string
}) {
  return (
    <div className="flex min-h-[7.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
      <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`text-2xl font-bold tabular-nums sm:text-3xl ${
          count > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        {count}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  )
}

function viewerClosureNet(closureLike: ClosureLike, isPartnerView: boolean): number {
  const closureData = closureLike.closure_data || {}
  const viewerCard =
    (isPartnerView ? closureData.partner_account_card : closureData.main_account_card) || {}
  const toReceive = parseFloat(String(viewerCard.total_to_receive ?? 0))
  const toPay = -Math.abs(parseFloat(String(viewerCard.total_to_pay ?? 0)))
  const loanToReceive = parseFloat(String(viewerCard.loan_to_receive ?? 0))
  const loanToPay = -Math.abs(parseFloat(String(viewerCard.loan_to_pay ?? 0)))
  const settlementCredit = getSettlementCreditSignedForViewer(closureLike, !isPartnerView)
  return toReceive + toPay + loanToReceive + loanToPay + settlementCredit
}

export default function ClosureRecalculateModal({
  closure,
  loggedAccountId,
  onClose,
  onApplied,
}: Props) {
  const [recalcTab, setRecalcTab] = useState<RecalcTab>('summary')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [preview, setPreview] = useState<ClosureRecalcPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createCreditLoansOnOverpay, setCreateCreditLoansOnOverpay] = useState(true)

  const loadPreview = useCallback(async () => {
    if (closure == null) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get<ClosureRecalcPreview>(
        `/api/balance/closures/${closure.id}/recalculate/preview`,
      )
      setPreview(data)
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string'
          ? e.response.data.detail
          : 'Erro ao recalcular fechamento'
      setError(msg)
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [closure])

  useEffect(() => {
    if (closure != null) {
      setRecalcTab('summary')
      void loadPreview()
    }
  }, [closure, loadPreview])

  const isPartnerView = useMemo(() => {
    if (!preview || loggedAccountId == null) return false
    const mainId = Number(
      (preview.proposed_closure_data.main_account_card as { account_id?: number })?.account_id,
    )
    return loggedAccountId !== mainId
  }, [preview, loggedAccountId])

  const previewClosure = useMemo(() => {
    if (!closure || !preview) return null
    return {
      ...closure,
      closure_data: preview.proposed_closure_data,
    }
  }, [closure, preview])

  const proposedItems = useMemo(() => {
    if (!preview) return []
    return buildAllClosureItems(preview.proposed_closure_data, isPartnerView)
  }, [preview, isPartnerView])

  const newItemKeys = useMemo(
    () => new Set((preview?.new_items ?? []).map((row) => row.key)),
    [preview],
  )

  const newItemsForTable = useMemo(
    () => proposedItems.filter((item) => newItemKeys.has(String(item._closure_key ?? ''))),
    [proposedItems, newItemKeys],
  )

  const newBySource = useMemo(() => {
    const bank = newItemsForTable.filter((i) => i.source_type === 'Conta Bancária')
    const card = newItemsForTable.filter((i) => i.source_type === 'Cartão de Crédito')
    const benefit = newItemsForTable.filter((i) => i.source_type === 'Cartão Benefício')
    return { bank, card, benefit }
  }, [newItemsForTable])

  const mainAccountId = useMemo(() => {
    if (!preview) return 0
    return Number(
      (preview.proposed_closure_data.main_account_card as { account_id?: number })?.account_id ?? 0,
    )
  }, [preview])

  const mainCard = preview?.proposed_closure_data.main_account_card as Record<string, unknown> | undefined
  const partnerCard = preview?.proposed_closure_data.partner_account_card as Record<string, unknown> | undefined

  const removedItemsForTable = useMemo(() => {
    if (!preview || loggedAccountId == null) return []
    return (preview.removed_items ?? []).map((row) =>
      buildDisplayItemFromRecalcRow(row, mainAccountId, mainCard, partnerCard, isPartnerView),
    )
  }, [preview, loggedAccountId, mainAccountId, mainCard, partnerCard, isPartnerView])

  const removedBySource = useMemo(() => {
    const bank = removedItemsForTable.filter((i) => i.source_type === 'Conta Bancária')
    const card = removedItemsForTable.filter((i) => i.source_type === 'Cartão de Crédito')
    const benefit = removedItemsForTable.filter((i) => i.source_type === 'Cartão Benefício')
    return { bank, card, benefit }
  }, [removedItemsForTable])

  const movementBySource = useMemo(() => {
    if (!preview || loggedAccountId == null) return undefined
    return aggregateRecalcMovementBySource(preview.new_items, preview.removed_items, loggedAccountId)
  }, [preview, loggedAccountId])

  const loanPayments = useMemo(() => {
    const data = preview?.proposed_closure_data ?? {}
    return (data.loan_payments as unknown[]) ?? []
  }, [preview])

  const counterpartCard = useMemo(() => {
    if (!preview) return null
    const main = preview.proposed_closure_data.main_account_card as Record<string, unknown> | undefined
    const partner = preview.proposed_closure_data.partner_account_card as Record<string, unknown> | undefined
    if (loggedAccountId == null) return partner ?? main ?? null
    const mainId = Number(main?.account_id ?? 0)
    const partnerId = Number(partner?.account_id ?? 0)
    if (loggedAccountId === mainId) return partner ?? null
    if (loggedAccountId === partnerId) return main ?? null
    return partner ?? main ?? null
  }, [preview, loggedAccountId])

  const balanceComparison = useMemo(() => {
    if (!closure || !previewClosure) return null
    const savedNet = viewerClosureNet(closure, isPartnerView)
    const proposedNet = viewerClosureNet(previewClosure, isPartnerView)
    const delta = proposedNet - savedNet
    return { savedNet, proposedNet, delta }
  }, [closure, previewClosure, isPartnerView])

  const recalcTabs = useMemo(
    () => [
      { key: 'summary' as const, label: 'Sumário', icon: <Scale size={14} /> },
      {
        key: 'altered' as const,
        label: 'Alterados',
        icon: <GitCompare size={14} />,
        count: preview?.summary.altered_count || undefined,
      },
      {
        key: 'new' as const,
        label: 'Novos',
        icon: <PlusCircle size={14} />,
        count: preview?.summary.new_count || undefined,
      },
      {
        key: 'removed' as const,
        label: 'Removidos',
        icon: <AlertTriangle size={14} />,
        count: preview?.summary.removed_count || undefined,
      },
    ],
    [preview],
  )

  const counterpartChrome =
    preview && counterpartCard ? (
      <div className="flex min-w-0 max-w-full items-center gap-2 sm:max-w-md">
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Contraparte
        </span>
        <span className="min-w-0 truncate">
          <SharedAccountDisplay
            account={{
              id: Number(counterpartCard.account_id ?? 0),
              name: String(counterpartCard.account_name ?? 'Sem nome'),
              bank: counterpartCard.bank_name ? { name: String(counterpartCard.bank_name) } : null,
              agency: counterpartCard.agency as string | number | null | undefined,
              account_number: counterpartCard.account_number as string | number | null | undefined,
            }}
          />
        </span>
      </div>
    ) : null

  const diffScorecards = preview?.has_changes ? (
    <article className={`${listPageTableSectionCls} mb-6 flex flex-col overflow-hidden`}>
      <RecalcDiffPanelHeader
        accentVar="var(--color-1)"
        icon={<GitCompare size={18} />}
        title="Diferenças detectadas"
        subtitle="Comparado ao snapshot salvo no fechamento"
      />
      <div className="grid flex-1 grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <RecalcDiffPanelCell
          label="Novos"
          icon={<PlusCircle size={14} className="text-[var(--color-success)]" />}
          count={preview.summary.new_count}
          hint="lançamentos no período"
        />
        <RecalcDiffPanelCell
          label="Alterados"
          icon={<GitCompare size={14} className="text-[var(--color-1)]" />}
          count={preview.summary.altered_count}
          hint="valor, descrição, parcelas…"
        />
        <RecalcDiffPanelCell
          label="Tag/subtag"
          icon={<Receipt size={14} className="text-[var(--color-3)]" />}
          count={preview.summary.tag_only_count}
          hint="somente metadado"
        />
        <RecalcDiffPanelCell
          label="Removidos"
          icon={<AlertTriangle size={14} className="text-[var(--color-danger)]" />}
          count={preview.summary.removed_count}
          hint="saíram do período"
        />
      </div>
    </article>
  ) : null

  const balanceSection = balanceComparison ? (
    <CadastroFormSection
      title="Saldo do fechamento"
      hint="Fechamento salvo vs proposta recalculada (sua perspectiva, inclui empréstimos do snapshot)."
      icon={<Scale size={14} />}
      bodyClassName="p-0"
      className="mb-6"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                Referência
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-gray-200 px-3 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">
                Fechamento salvo
              </td>
              <td
                className={`border-b border-gray-200 px-3 py-2 text-right tabular-nums font-semibold dark:border-gray-600 ${moneyTone(balanceComparison.savedNet)}`}
              >
                {formatSignedMoney(balanceComparison.savedNet)}
              </td>
            </tr>
            <tr>
              <td className="border-b border-gray-200 px-3 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">
                Proposta recalculada
              </td>
              <td
                className={`border-b border-gray-200 px-3 py-2 text-right tabular-nums font-semibold dark:border-gray-600 ${moneyTone(balanceComparison.proposedNet)}`}
              >
                {formatSignedMoney(balanceComparison.proposedNet)}
              </td>
            </tr>
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50">
            <tr>
              <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <ArrowLeftRight size={14} className="text-gray-400" />
                  Diferença
                </span>
              </td>
              <td
                className={`px-3 py-2.5 text-right text-base tabular-nums font-bold ${
                  Math.abs(balanceComparison.delta) < 0.01
                    ? 'text-gray-500 dark:text-gray-400'
                    : moneyTone(balanceComparison.delta)
                }`}
              >
                {Math.abs(balanceComparison.delta) < 0.01
                  ? 'Sem alteração'
                  : formatSignedMoney(balanceComparison.delta)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </CadastroFormSection>
  ) : null

  const applyRecalc = async (resolution: 'none' | 'reconcile_credit_loans') => {
    if (closure == null) return
    setApplying(true)
    setError(null)
    try {
      await axios.post(`/api/balance/closures/${closure.id}/recalculate/apply`, {
        settlement_resolution: resolution,
      })
      onApplied()
      onClose()
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const detail = e.response?.data?.detail
        setError(
          typeof detail === 'string'
            ? detail
            : typeof detail === 'object' && detail?.message
              ? String(detail.message)
              : 'Erro ao aplicar recálculo',
        )
      } else {
        setError('Erro ao aplicar recálculo')
      }
    } finally {
      setApplying(false)
    }
  }

  const handleConfirm = () => {
    if (!preview?.has_changes || closure == null) return
    setApplyDialogOpen(true)
  }

  const confirmApply = () => {
    if (!preview) return
    const resolution = preview.settlement.requires_resolution
      ? createCreditLoansOnOverpay
        ? 'reconcile_credit_loans'
        : 'none'
      : 'none'
    setApplyDialogOpen(false)
    void applyRecalc(resolution)
  }

  if (closure == null) return null

  const periodLabel = preview
    ? `${preview.period.start} → ${preview.period.end}`
    : `${formatDateTimeBR(closure.period_start_date)} a ${formatDateTimeBR(closure.closing_date)}`

  return (
    <>
      <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90rem]" maxHeight="max-h-[90vh]" zClass="z-[105]">
        <CadastroModalHeader
          isEdit={false}
          title={`Recalcular — ${String(closure.month).padStart(2, '0')}/${closure.year}`}
          titleAddon={
            balanceComparison && Math.abs(balanceComparison.proposedNet) >= 0.01 ? (
              <LoanDirectionBadge receive={balanceComparison.proposedNet > 0} size="md" />
            ) : balanceComparison ? (
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Zerado</span>
            ) : null
          }
          subtitle={`${proposedItems.length} itens (proposta) • ${periodLabel}`}
          onClose={onClose}
          icon={<RefreshCw size={18} />}
        />
        <CadastroModalBody
          chrome={
            preview ? (
              preview.has_changes ? (
                <CadastroListPageTabs
                  tabs={recalcTabs}
                  active={recalcTab}
                  onChange={setRecalcTab}
                  trailing={
                    counterpartChrome || preview.summary.tag_only_count > 0 ? (
                      <div className="flex max-w-[min(100%,28rem)] flex-wrap items-center justify-end gap-2">
                        {counterpartChrome}
                        {preview.summary.tag_only_count > 0 ? (
                          <Badge
                            variant="filter"
                            tone="brand2"
                            label={`${preview.summary.tag_only_count} tag/subtag`}
                          />
                        ) : null}
                      </div>
                    ) : null
                  }
                />
              ) : counterpartChrome ? (
                <div className="mb-4 flex justify-end border-b border-gray-200 pb-3 dark:border-gray-700">
                  {counterpartChrome}
                </div>
              ) : null
            ) : undefined
          }
        >
          {loading && (
            <div className="py-12">
              <LoadingSpinner message="Buscando lançamentos do período…" />
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}
          {!loading && preview && !preview.has_changes && (
            <>
              {balanceSection}
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                Nenhuma diferença em relação ao fechamento salvo.
              </div>
            </>
          )}
          {!loading && preview?.has_changes && recalcTab === 'summary' && previewClosure && (
            <>
              {diffScorecards}
              {balanceSection}
              <SharedClosureItemsView
                closure={previewClosure}
                items={proposedItems}
                loanPayments={loanPayments}
                isPartnerView={isPartnerView}
                activeTab="geral"
                hideClosureBalanceSection
                compareSavedClosureData={
                  closure.closure_data ? (closure.closure_data as Record<string, unknown>) : undefined
                }
                recalcMovementBySource={movementBySource}
                recalcExpectedNewCount={preview.summary.new_count}
                recalcExpectedRemovedCount={preview.summary.removed_count}
              />
            </>
          )}
          {!loading && preview?.has_changes && recalcTab === 'altered' && (
            <CadastroFormSection
              title="Lançamentos alterados"
              hint="Extrato, cartão e benefício — valor, descrição, parcelas ou percentual."
              icon={<GitCompare size={14} />}
              bodyClassName="p-0"
            >
              <AlteredClosureItemsTable rows={preview.altered_items} />
            </CadastroFormSection>
          )}
          {!loading && preview?.has_changes && recalcTab === 'new' && (
            <div className="space-y-6">
              {newItemsForTable.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">Nenhum lançamento novo.</p>
              ) : (
                <>
                  {newBySource.bank.length > 0 && (
                    <CadastroFormSection title="Conta corrente" icon={<Landmark size={14} />} bodyClassName="p-0">
                      <ItemsTable items={newBySource.bank} showCard={false} />
                    </CadastroFormSection>
                  )}
                  {newBySource.card.length > 0 && (
                    <CadastroFormSection title="Cartão de crédito" icon={<CreditCard size={14} />} bodyClassName="p-0">
                      <ItemsTable items={newBySource.card} showCard />
                    </CadastroFormSection>
                  )}
                  {newBySource.benefit.length > 0 && (
                    <CadastroFormSection title="Cartão benefício" icon={<Gift size={14} />} bodyClassName="p-0">
                      <ItemsTable items={newBySource.benefit} showCard />
                    </CadastroFormSection>
                  )}
                </>
              )}
            </div>
          )}
          {!loading && preview?.has_changes && recalcTab === 'removed' && (
            <div className="space-y-6">
              {removedItemsForTable.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">Nenhum lançamento removido do período.</p>
              ) : (
                <>
                  {removedBySource.bank.length > 0 && (
                    <CadastroFormSection
                      title="Conta corrente"
                      hint="Lançamentos que estavam no fechamento salvo e não entram mais na proposta."
                      icon={<Landmark size={14} />}
                      bodyClassName="p-0"
                    >
                      <ItemsTable items={removedBySource.bank} showCard={false} />
                    </CadastroFormSection>
                  )}
                  {removedBySource.card.length > 0 && (
                    <CadastroFormSection title="Cartão de crédito" icon={<CreditCard size={14} />} bodyClassName="p-0">
                      <ItemsTable items={removedBySource.card} showCard />
                    </CadastroFormSection>
                  )}
                  {removedBySource.benefit.length > 0 && (
                    <CadastroFormSection title="Cartão benefício" icon={<Gift size={14} />} bodyClassName="p-0">
                      <ItemsTable items={removedBySource.benefit} showCard />
                    </CadastroFormSection>
                  )}
                </>
              )}
            </div>
          )}
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={onClose}
          hideSave={!preview?.has_changes}
          saveLabel={applying ? 'Aplicando…' : 'Atualizar fechamento'}
          onSave={handleConfirm}
          disabled={applying || loading || !preview?.has_changes}
          saving={applying}
        />
      </CadastroModalShell>

      {applyDialogOpen && preview ? (
        <CadastroModalShell maxWidth="max-w-lg" zClass="z-[110]" onBackdropClick={() => setApplyDialogOpen(false)}>
          <CadastroModalHeader
            isEdit={false}
            title="Confirmar recálculo"
            onClose={() => setApplyDialogOpen(false)}
            icon={<AlertTriangle size={18} />}
            iconStyle={{
              backgroundColor: 'var(--color-warning)',
              color: 'var(--on-color-warning)',
            }}
          />
          <CadastroModalBody>
            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
              <p>Atualizar o fechamento com os valores recalculados?</p>
              {preview.settlement.auto_reopen ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-100">
                  O saldo devedor aumentou — a quitação será removida ao aplicar.
                </p>
              ) : null}
              {preview.settlement.requires_resolution ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-50">
                  <p>
                    Total pago {formatCurrency(preview.settlement.total_paid)} é maior que o novo saldo a receber{' '}
                    {formatCurrency(Math.abs(preview.summary.new_net_amount))}. Excedente:{' '}
                    <strong>{formatCurrency(preview.settlement.overpayment_amount)}</strong>.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={createCreditLoansOnOverpay}
                      onChange={(e) => setCreateCreditLoansOnOverpay(e.target.checked)}
                    />
                    <span>Gerar empréstimo a pagar pelo excedente</span>
                  </label>
                  {!createCreditLoansOnOverpay ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Atualiza o fechamento sem gerar empréstimo.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setApplyDialogOpen(false)}
            onSave={confirmApply}
            closeLabel="Cancelar"
            saveLabel="Atualizar fechamento"
            saving={applying}
            disabled={applying}
            saveTone="success"
          />
        </CadastroModalShell>
      ) : null}
    </>
  )
}
