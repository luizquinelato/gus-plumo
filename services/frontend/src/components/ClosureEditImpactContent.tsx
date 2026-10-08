import { Tag, TrendingUp, AlertTriangle } from 'lucide-react'
import {
  CadastroFormSection,
  cadastroSectionsStackCls,
} from './CadastroFormLayout'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import { closureImpactConfirmMessage, formatMoneyBr } from '../utils/closureEditImpact'

interface ClosureEditImpactContentProps {
  baseMessage?: string
  impact: ClosureEditImpact
  showIntroMessage?: boolean
  /** confirm = aviso antes de aplicar; summary = resumo pós-aplicação com tabela/contagens */
  variant?: 'confirm' | 'summary'
}

const ClosureEditImpactContent = ({
  baseMessage,
  impact,
  showIntroMessage = true,
  variant = 'summary',
}: ClosureEditImpactContentProps) => {
  const classification = impact.classification
  const periods = impact.financial?.affected_periods ?? []
  const showFinancial =
    variant === 'summary' && (impact.impact_type === 'financial' || periods.length > 0)
  const showClassification =
    variant === 'summary' &&
    !showFinancial &&
    classification &&
    (impact.impact_type === 'classification' || impact.impact_type === 'split_recalc')

  if (variant === 'confirm') {
    return (
      <div className={cadastroSectionsStackCls}>
        {baseMessage ? (
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{baseMessage}</p>
        ) : null}
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p>{closureImpactConfirmMessage(impact)}</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/90">
              Após confirmar, o sistema recalcula os fechamentos e mostra um resumo das alterações.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cadastroSectionsStackCls}>
      {baseMessage ? (
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{baseMessage}</p>
      ) : null}
      {showIntroMessage && impact.message ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{impact.message}</p>
      ) : null}

      {showClassification ? (
        <CadastroFormSection
          title={
            impact.impact_type === 'split_recalc'
              ? 'Compartilhamento nos fechamentos'
              : 'Classificação nos fechamentos'
          }
          icon={<Tag size={14} />}
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/40">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Registros atualizados
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {classification.records_updated}
              </dd>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/40">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Meses fechados atualizados
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {classification.closed_months_refreshed}
              </dd>
            </div>
          </dl>
          {showIntroMessage && classification.year_months.length > 0 ? (
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              Meses: {classification.year_months.join(', ')}
            </p>
          ) : null}
        </CadastroFormSection>
      ) : null}

      {impact.impact_type === 'split_recalc' && !showFinancial ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>Os splits dos fechamentos serão recalculados nos meses impactados.</p>
        </div>
      ) : null}

      {showFinancial ? (
        <CadastroFormSection title="Saldo final por mês" icon={<TrendingUp size={14} />}>
          {periods.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Nenhuma alteração de saldo foi registrada nos fechamentos.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-600">
                <thead className="bg-gray-50 dark:bg-gray-900/60">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Mês
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Antes
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Depois
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Δ
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                  {periods.map((row) => (
                    <tr key={row.year_month}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-800 dark:text-gray-100">
                        {row.year_month}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                        {formatMoneyBr(row.closing_old)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                        {formatMoneyBr(row.closing_new)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${
                          row.delta_closing >= 0
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {row.delta_closing >= 0 ? '+' : ''}
                        {formatMoneyBr(row.delta_closing)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CadastroFormSection>
      ) : null}

      {!showClassification && !showFinancial ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">Nenhum fechamento foi alterado.</p>
      ) : null}
    </div>
  )
}

export default ClosureEditImpactContent
