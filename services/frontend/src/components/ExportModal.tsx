import { useState, useEffect } from 'react'
import { Download, Files, FileSpreadsheet, Users } from 'lucide-react'
import { ExpenseExportData, exportToExcel, exportToExcelSeparado, ExportOptions } from '../utils/exportToExcel'
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
  onClose: () => void
  expenses: ExpenseExportData[]
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export default function ExportModal({ isOpen, onClose, expenses, onSuccess, onError }: ExportModalProps) {
  const [exportMode, setExportMode] = useState<'single' | 'separate'>('single')
  const [includeSharing, setIncludeSharing] = useState(false)

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
  }, [isOpen, exportMode, includeSharing])

  const handleExport = () => {
    if (!expenses || expenses.length === 0) {
      onError('Nenhum dado para exportar')
      return
    }

    const options: ExportOptions = { includeSharing }

    if (exportMode === 'single') {
      exportToExcel(expenses, undefined, options)
      onSuccess(`Exportado com sucesso! ${expenses.length} transações`)
    } else {
      const result = exportToExcelSeparado(expenses, options)
      const partes = []
      if (result.extratos > 0) partes.push(`${result.extratos} extratos`)
      if (result.faturas > 0) partes.push(`${result.faturas} faturas`)
      if (result.beneficios > 0) partes.push(`${result.beneficios} benefícios`)
      onSuccess(`Exportados ${partes.join(', ')} em arquivos separados`)
    }

    onClose()
  }

  const sharedCount = expenses.filter(e => e.shared_partner_name).length

  if (!isOpen) return null

  return (
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title="Exportar para Excel"
        subtitle={`${expenses.length} transações serão exportadas`}
        onClose={onClose}
        icon={<FileSpreadsheet size={18} />}
      />
      <CadastroModalBody>
        <CadastroFormSection title="Formato" icon={<Download size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <label className={cadastroOptionLabelCls}>
                <input
                  type="radio"
                  name="exportMode"
                  value="single"
                  checked={exportMode === 'single'}
                  onChange={() => setExportMode('single')}
                  className={`${cadastroAccentControlCls} h-4 w-4 border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">Arquivo único</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">1 arquivo Excel com 3 abas</span>
                </span>
              </label>
            </CadastroModalFieldsRow>
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
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Files size={14} />
                    Arquivos separados
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    3 arquivos individuais (extratos, faturas, benefícios)
                  </span>
                </span>
              </label>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
        <CadastroFormSection title="Opções" icon={<Users size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <label className={cadastroOptionLabelCls}>
                <input
                  type="checkbox"
                  checked={includeSharing}
                  onChange={(e) => setIncludeSharing(e.target.checked)}
                  className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">Incluir compartilhamento</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    Adiciona colunas: Conta Parceira, Minha Contribuição (%)
                    {sharedCount > 0 ? ` · ${sharedCount} com compartilhamento` : ''}
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
  )
}
