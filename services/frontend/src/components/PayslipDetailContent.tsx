import { formatDateBR } from '../utils/dateUtils'
import { CadastroFormSection, CadastroModalFieldsGrid, CadastroModalFieldsRow, CadastroFieldLabel } from './CadastroFormLayout'

export interface PayslipLine {
  id: number
  section: string
  line_code?: string | null
  description: string
  quantity?: number | null
  earnings_amount?: number | null
  deduction_amount?: number | null
  base_amount?: number | null
  line_type_name?: string | null
}

export interface PayslipPayment {
  kind: string
  payment_date?: string | null
  net_amount?: number | null
}

export interface PayslipDetail {
  id: number
  employee_name?: string | null
  employee_role?: string | null
  employee_registration?: string | null
  employer_name?: string | null
  reference_label?: string | null
  payslip_kind?: string | null
  year?: number | null
  month?: number | null
  payment_date?: string | null
  gross_earnings?: number | null
  total_deductions?: number | null
  net_amount?: number | null
  payments?: PayslipPayment[]
  lines: PayslipLine[]
}

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))

const ADVANCE_EARNING_CODE = '2820'
const ADVANCE_DEDUCTION_CODE = '2821'

const PAYSLIP_SECTIONS = [
  { key: 'entries_deductions', label: 'Vencimentos e Descontos' },
  { key: 'base_values', label: 'Base / Outros' },
] as const

const normalizePayslipSection = (section: string) => {
  if (section === 'entries' || section === 'deductions') return 'entries_deductions'
  return section
}

const hasFinalSheet = (payslip: PayslipDetail) => {
  const kind = payslip.payslip_kind
  if (kind === 'final' || kind === 'consolidated') return true
  return (payslip.payments || []).some((payment) => payment.kind === 'final')
}

const isAdvanceTransferLine = (line: PayslipLine, hasFinal: boolean) => {
  const code = (line.line_code || '').trim()
  if (code === ADVANCE_DEDUCTION_CODE) return true
  return hasFinal && code === ADVANCE_EARNING_CODE
}

const isAccountLine = (line: PayslipLine) => normalizePayslipSection(line.section) === 'entries_deductions'

const computeAccountTotals = (lines: PayslipLine[]) =>
  lines
    .filter(isAccountLine)
    .reduce(
      (acc, line) => ({
        earnings: acc.earnings + Number(line.earnings_amount || 0),
        deductions: acc.deductions + Number(line.deduction_amount || 0),
      }),
      { earnings: 0, deductions: 0 },
    )

const groupPayslipLines = (lines: PayslipLine[]) =>
  PAYSLIP_SECTIONS.map((section) => ({
    ...section,
    lines: lines.filter((line) => normalizePayslipSection(line.section) === section.key),
  })).filter((section) => section.lines.length > 0)

export const payslipPaymentLabel = (kind: string, payments: PayslipPayment[] = []) => {
  if (kind === 'advance') return 'Adiantamento'
  if (kind === 'final') return 'Final de mês'
  if (kind === 'regular' && payments.some((payment) => payment.kind === 'advance')) return 'Final de mês'
  if (kind === 'regular') return 'Mensal'
  if (kind === 'profit_share') return 'Participação nos lucros'
  return 'Pagamento'
}

export const formatPayslipPaymentDay = (value?: string | null) => {
  if (!value) return null
  const formatted = formatDateBR(value)
  return formatted ? formatted.slice(0, 5) : null
}

export function PayslipDetailContent({ payslip }: { payslip: PayslipDetail }) {
  const payments = payslip.payments || []
  const hasFinal = hasFinalSheet(payslip)
  const visibleLines = (payslip.lines || []).filter((line) => !isAdvanceTransferLine(line, hasFinal))
  const sections = groupPayslipLines(visibleLines)
  const totals = computeAccountTotals(visibleLines)

  return (
    <>
      <CadastroFormSection title="Resumo">
        <CadastroModalFieldsGrid>
          <CadastroModalFieldsRow cols={3}>
            <div>
              <CadastroFieldLabel>Vencimentos</CadastroFieldLabel>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-success)]">{formatCurrency(totals.earnings)}</p>
            </div>
            <div>
              <CadastroFieldLabel>Descontos</CadastroFieldLabel>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-danger)]">-{formatCurrency(totals.deductions)}</p>
            </div>
            <div>
              <CadastroFieldLabel>Líquido</CadastroFieldLabel>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-success)]">
                {formatCurrency(totals.earnings - totals.deductions)}
              </p>
            </div>
          </CadastroModalFieldsRow>
        </CadastroModalFieldsGrid>
      </CadastroFormSection>

      {payments.length > 0 && (
        <CadastroFormSection title="Pagamentos do mês" bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead
                className="border-b border-gray-200 dark:border-gray-700"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-1) 14%, transparent)' }}
              >
                <tr>
                  <th className="px-3 py-2 text-left">Parcela</th>
                  <th className="px-3 py-2 text-left">Dia</th>
                  <th className="px-3 py-2 text-right">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment, index) => (
                  <tr
                    key={`${payment.kind}-${payment.payment_date || index}`}
                    className="border-t border-gray-200 dark:border-gray-700"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-1) 8%, transparent)' }}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                      {payslipPaymentLabel(payment.kind, payments)}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {formatPayslipPaymentDay(payment.payment_date) || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--color-success)]">
                      {formatCurrency(payment.net_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </CadastroFormSection>
      )}

      {sections.map((section) => (
        <CadastroFormSection key={section.key} title={section.label} bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/70">
              <tr>
                <th className="px-3 py-2 text-left">Conta</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                {section.key === 'entries_deductions' ? (
                  <>
                    <th className="px-3 py-2 text-right">Qtde</th>
                    <th className="px-3 py-2 text-right">Vencimentos</th>
                    <th className="px-3 py-2 text-right">Descontos</th>
                  </>
                ) : (
                  <th className="px-3 py-2 text-right">Base</th>
                )}
              </tr>
            </thead>
            <tbody>
              {section.lines.map((line) => (
                <tr key={line.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-3 py-2">{line.line_code || '-'}</td>
                  <td className="px-3 py-2">{line.line_type_name || line.description}</td>
                  {section.key === 'entries_deductions' ? (
                    <>
                      <td className="px-3 py-2 text-right">
                        {line.quantity != null ? Number(line.quantity).toLocaleString('pt-BR') : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-success)]">
                        {line.earnings_amount ? formatCurrency(line.earnings_amount) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-danger)]">
                        {line.deduction_amount ? `-${formatCurrency(line.deduction_amount)}` : '-'}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-right">{formatCurrency(line.base_amount)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CadastroFormSection>
      ))}
    </>
  )
}

