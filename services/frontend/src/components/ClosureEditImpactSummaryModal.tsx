import { CheckCircle } from 'lucide-react'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
} from './CadastroFormLayout'
import ClosureEditImpactContent from './ClosureEditImpactContent'
import type { ClosureEditImpact } from '../types/closureEditImpact'

export interface ImportIssueRow {
  source?: string
  row: number
  reason: string
}

const IMPORT_STAT_LABELS: Record<string, string> = {
  created: 'Criados',
  updated: 'Atualizados',
  unchanged: 'Sem alteração',
  skipped_invalid: 'Ignorados',
  remap_records: 'Lanç. remapeados',
  issues: 'Avisos',
}

function formatImportIssueLine(issue: ImportIssueRow): string {
  if (issue.source === 'bank') return `Extrato linha ${issue.row}: ${issue.reason}`
  if (issue.source === 'benefit') return `Benefício linha ${issue.row}: ${issue.reason}`
  return `Linha ${issue.row}: ${issue.reason}`
}

interface ClosureEditImpactSummaryModalProps {
  isOpen: boolean
  title?: string
  subtitle?: string
  baseMessage: string
  impact: ClosureEditImpact | null
  importIssues?: ImportIssueRow[]
  importStats?: Record<string, number>
  onClose: () => void
}

const ClosureEditImpactSummaryModal = ({
  isOpen,
  title,
  subtitle,
  baseMessage,
  impact,
  importIssues,
  importStats,
  onClose,
}: ClosureEditImpactSummaryModalProps) => {
  if (!isOpen) return null
  const hasIssues = Boolean(importIssues?.length)
  if (!impact && !hasIssues) return null

  const resolvedTitle =
    title ??
    (impact ? 'Resumo das alterações nos fechamentos' : 'Resumo da importação')
  const resolvedSubtitle =
    subtitle ?? (impact ? 'Impacto nos meses já fechados' : 'Resultado da operação')

  return (
    <CadastroModalShell
      maxWidth={hasIssues ? 'max-w-2xl' : 'max-w-xl'}
      onBackdropClick={onClose}
      zClass="z-[120]"
    >
      <CadastroModalHeader
        isEdit={false}
        title={resolvedTitle}
        subtitle={resolvedSubtitle}
        onClose={onClose}
        icon={<CheckCircle size={18} />}
        iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
      />
      <CadastroModalBody>
        {impact ? (
          <ClosureEditImpactContent
            baseMessage={baseMessage}
            impact={impact}
            variant="summary"
            showIntroMessage={false}
          />
        ) : (
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{baseMessage}</p>
        )}
        {importStats && Object.keys(importStats).length > 0 ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-3">
            {Object.entries(importStats).map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium text-gray-500 dark:text-gray-400">
                  {IMPORT_STAT_LABELS[key] ?? key.replace(/_/g, ' ')}
                </dt>
                <dd className="tabular-nums text-gray-800 dark:text-gray-100">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {hasIssues ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="mb-2 text-sm font-semibold text-amber-950 dark:text-amber-100">
              Avisos da importação ({importIssues!.length})
            </p>
            <ul className="max-h-[min(16rem,40vh)] space-y-1 overflow-y-auto text-xs text-amber-900 dark:text-amber-200">
              {importIssues!.map((issue, i) => (
                <li key={`${issue.source ?? 'row'}-${issue.row}-${i}`}>{formatImportIssueLine(issue)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} onSave={onClose} saveLabel="Entendi" closeLabel="Fechar" />
    </CadastroModalShell>
  )
}

export default ClosureEditImpactSummaryModal
