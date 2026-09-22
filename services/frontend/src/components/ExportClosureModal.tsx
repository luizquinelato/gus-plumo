import React, { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
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

interface ExportClosureModalProps {
  isOpen: boolean
  onClose: () => void
  onExport: (format: 'pdf' | 'excel', absoluteValues: boolean) => void
}

export const ExportClosureModal: React.FC<ExportClosureModalProps> = ({
  isOpen,
  onClose,
  onExport
}) => {
  const [format, setFormat] = useState<'pdf' | 'excel'>('pdf')
  const [absoluteValues, setAbsoluteValues] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setFormat('pdf')
      setAbsoluteValues(false)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        onExport(format, absoluteValues)
        onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, format, absoluteValues, onClose, onExport])

  if (!isOpen) return null

  return (
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title="Exportar Fechamento"
        subtitle="Escolha o formato e as opções de valores"
        onClose={onClose}
        icon={<Download size={18} />}
      />
      <CadastroModalBody>
        <CadastroFormSection title="Formato" icon={<FileText size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow cols={2}>
              <button
                type="button"
                onClick={() => setFormat('pdf')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  format === 'pdf'
                    ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_12%,white)] text-gray-900 dark:bg-[color-mix(in_srgb,var(--color-1)_20%,transparent)] dark:text-white'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-400'
                }`}
              >
                <FileText size={16} />
                PDF
              </button>
              <button
                type="button"
                onClick={() => setFormat('excel')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  format === 'excel'
                    ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_12%,white)] text-gray-900 dark:bg-[color-mix(in_srgb,var(--color-1)_20%,transparent)] dark:text-white'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-400'
                }`}
              >
                <FileSpreadsheet size={16} />
                Excel
              </button>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
        <CadastroFormSection title="Opções" icon={<Download size={14} />}>
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked={absoluteValues}
                  onChange={e => setAbsoluteValues(e.target.checked)}
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium">Valores absolutos</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    Remove os sinais +/− de todos os valores. As cores verde/vermelho são mantidas.
                  </span>
                </span>
              </label>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={() => { onExport(format, absoluteValues); onClose() }}
        saveLabel="Exportar"
        saveIcon={<Download size={15} />}
      />
    </CadastroModalShell>
  )
}
