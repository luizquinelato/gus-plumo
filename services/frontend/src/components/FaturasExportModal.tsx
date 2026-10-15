import { useState, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { useExportRunner } from '../hooks/useExportRunner'
import { exportFaturasReport, type FaturaReportExportItem } from '../utils/exportToExcel'
import { exportFaturasReportToPdf } from '../utils/exportExtratoReportPdf'
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

interface FaturasExportModalProps {
  isOpen: boolean
  format: 'excel' | 'pdf'
  onClose: () => void
  items: FaturaReportExportItem[]
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export default function FaturasExportModal({ isOpen, format, onClose, items, onSuccess, onError }: FaturasExportModalProps) {
  const isPdf = format === 'pdf'
  const [mode, setMode] = useState<'unified' | 'separate'>('separate')
  const exportRunner = useExportRunner(() => onError(`Não foi possível gerar o arquivo ${isPdf ? 'PDF' : 'Excel'}`))

  useEffect(() => {
    if (isOpen) setMode('separate')
  }, [isOpen])

  const handleExport = async () => {
    if (!items.length) {
      onError('Nenhum dado para exportar')
      return
    }
    const ok = await exportRunner.run(isPdf ? 'Gerando PDF…' : 'Gerando Excel…', async () => {
      if (isPdf) await exportFaturasReportToPdf(items, undefined, { mode })
      else await exportFaturasReport(items, { mode })
      onSuccess(`${isPdf ? 'PDF' : 'Excel'} exportado (${items.length} lançamentos)`)
    })
    if (ok) onClose()
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' && !e.shiftKey) void handleExport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, mode, format, items])

  if (!isOpen) return null

  const options: { value: 'separate' | 'unified'; title: string; hint: string }[] = [
    {
      value: 'separate',
      title: 'Separado',
      hint: isPdf
        ? 'Por ano e mês, uma tabela por cartão, com página nova a cada mês'
        : 'Uma aba por ano/mês, com os lançamentos agrupados por cartão',
    },
    {
      value: 'unified',
      title: 'Unificado',
      hint: isPdf ? 'Tudo em uma única tabela, agrupada por cartão' : 'Tudo em uma única aba, agrupada por cartão',
    },
  ]

  return (
    <>
      <CadastroModalShell maxWidth="max-w-md">
        <CadastroModalHeader
          isEdit={false}
          title={isPdf ? 'Exportar para PDF' : 'Exportar para Excel'}
          subtitle={`${items.length} lançamentos serão exportados`}
          onClose={onClose}
          icon={isPdf ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
        />
        <CadastroModalBody>
          <CadastroFormSection title="Formato" icon={<Download size={14} />}>
            <CadastroModalFieldsGrid>
              {options.map((opt) => (
                <CadastroModalFieldsRow key={opt.value}>
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="radio"
                      name="faturasExportMode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className={`${cadastroAccentControlCls} h-4 w-4 border-gray-300`}
                    />
                    <span>
                      <span className="block text-sm font-medium">{opt.title}</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{opt.hint}</span>
                    </span>
                  </label>
                </CadastroModalFieldsRow>
              ))}
            </CadastroModalFieldsGrid>
          </CadastroFormSection>
        </CadastroModalBody>
        <CadastroModalFooter onClose={onClose} onSave={handleExport} saveLabel="Exportar" saveIcon={<Download size={15} />} />
      </CadastroModalShell>
      {exportRunner.overlay}
    </>
  )
}
