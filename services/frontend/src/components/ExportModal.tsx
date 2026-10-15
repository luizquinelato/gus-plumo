import { useState, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText, Settings2 } from 'lucide-react'
import { useExportRunner } from '../hooks/useExportRunner'
import { ExpenseExportData, exportToExcel, ExportOptions } from '../utils/exportToExcel'
import { exportExtratoReportToPdf } from '../utils/exportExtratoReportPdf'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
  cadastroOptionLabelCls,
} from './CadastroFormLayout'

interface ExportModalProps {
  isOpen: boolean
  format: 'excel' | 'pdf'
  onClose: () => void
  expenses: ExpenseExportData[]
  /** Linhas de saldo diário calculadas para o filtro atual (usadas se o checkbox estiver marcado). */
  dailyBalanceRows: ExpenseExportData[]
  /** Valor inicial do checkbox (igual ao filtro do relatório). */
  defaultIncludeDailyBalance: boolean
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export default function ExportModal({
  isOpen,
  format,
  onClose,
  expenses,
  dailyBalanceRows,
  defaultIncludeDailyBalance,
  onSuccess,
  onError,
}: ExportModalProps) {
  const isPdf = format === 'pdf'
  const [exportMode, setExportMode] = useState<'unified' | 'separate'>('separate')
  const [includeDailyBalance, setIncludeDailyBalance] = useState(defaultIncludeDailyBalance)
  const exportRunner = useExportRunner(() => onError(`Não foi possível gerar o arquivo ${isPdf ? 'PDF' : 'Excel'}`))

  useEffect(() => {
    if (isOpen) {
      setIncludeDailyBalance(defaultIncludeDailyBalance)
      setExportMode('separate')
    }
  }, [isOpen, defaultIncludeDailyBalance])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        handleExport()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, exportMode, includeDailyBalance, format])

  const handleExport = async () => {
    if (!expenses || expenses.length === 0) {
      onError('Nenhum dado para exportar')
      return
    }

    const daily = includeDailyBalance ? dailyBalanceRows : []

    const ok = await exportRunner.run(isPdf ? 'Gerando PDF…' : 'Gerando Excel…', async () => {
      if (isPdf) {
        await exportExtratoReportToPdf(expenses, 'Extrato de transações (filtrado)', {
          mode: exportMode,
          dailyBalanceRows: daily,
        })
        onSuccess(`PDF exportado (${expenses.length} lançamentos)`)
        return
      }
      const options: ExportOptions = { includeSharing: true, mode: exportMode, dailyBalanceRows: daily }
      await exportToExcel(expenses, undefined, options)
      onSuccess(`Exportado com sucesso! ${expenses.length} transações`)
    })

    if (ok) onClose()
  }

  if (!isOpen) return null

  return (
    <>
    <CadastroModalShell maxWidth="max-w-md">
      <CadastroModalHeader
        isEdit={false}
        title={isPdf ? 'Exportar para PDF' : 'Exportar para Excel'}
        subtitle={`${expenses.length} transações serão exportadas`}
        onClose={onClose}
        icon={isPdf ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
      />
      <CadastroModalBody>
        <CadastroFormSection title="Formato" icon={<Download size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <label className={cadastroOptionLabelCls}>
                <input
                  type="radio"
                  name="exportMode"
                  value="separate"
                  checked={exportMode === 'separate'}
                  onChange={() => setExportMode('separate')}
                  className={`${cadastroAccentControlCls} h-4 w-4 border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">{isPdf ? 'Separado' : 'Abas Separadas'}</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    {isPdf ? 'Extrato primeiro, depois uma tabela para benefícios' : 'Uma aba para extrato e outra para benefícios'}
                  </span>
                </span>
              </label>
            </CadastroModalFieldsRow>
            <CadastroModalFieldsRow>
              <label className={cadastroOptionLabelCls}>
                <input
                  type="radio"
                  name="exportMode"
                  value="unified"
                  checked={exportMode === 'unified'}
                  onChange={() => setExportMode('unified')}
                  className={`${cadastroAccentControlCls} h-4 w-4 border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">Unificado</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    {isPdf ? 'Tudo junto em uma única tabela' : 'Extrato e benefícios em uma única aba'}
                  </span>
                </span>
              </label>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
        <CadastroFormSection title="Opções" icon={<Settings2 size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <label className={cadastroOptionLabelCls}>
                <input
                  type="checkbox"
                  checked={includeDailyBalance}
                  onChange={(e) => setIncludeDailyBalance(e.target.checked)}
                  className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">Incluir saldo diário</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    Linha de resultado por dia{isPdf ? '' : ' em cada aba'}
                  </span>
                </span>
              </label>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={handleExport}
        saveLabel="Exportar"
        saveIcon={<Download size={15} />}
      />
    </CadastroModalShell>
    {exportRunner.overlay}
    </>
  )
}
