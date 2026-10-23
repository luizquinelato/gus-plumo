import React, { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import {
  CadastroFieldLabel,
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
  title?: string
  subtitle?: string
  /** Esconde a opção "Valores absolutos" (não se aplica a todos os relatórios). */
  hideAbsoluteOption?: boolean
  /** Conteúdo extra (ex.: campos de preenchimento), exibido entre o formato e as opções. */
  children?: React.ReactNode | ((format: 'pdf' | 'excel') => React.ReactNode)
  /** Fecha ao clicar fora do modal (padrão: sim). */
  closeOnBackdrop?: boolean
  /** Bloco de identificação exibido acima do formato (ex.: dados do consórcio). */
  summary?: React.ReactNode
  /** Largura máxima do modal (classe Tailwind). */
  maxWidth?: string
}

export const ExportClosureModal: React.FC<ExportClosureModalProps> = ({
  isOpen,
  onClose,
  onExport,
  title = 'Exportar Fechamento',
  subtitle = 'Escolha o formato e as opções de valores',
  hideAbsoluteOption = false,
  children,
  closeOnBackdrop = true,
  summary,
  maxWidth = 'max-w-md',
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
    <CadastroModalShell maxWidth={maxWidth} onBackdropClick={closeOnBackdrop ? onClose : undefined}>
      <CadastroModalHeader
        isEdit={false}
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        icon={<Download size={18} />}
      />
      <CadastroModalBody>
        {summary}
        <CadastroFormSection title="Formato" icon={<FileText size={14} />} bodyClassName="p-0">
          <CadastroModalFieldsGrid>
            <CadastroModalFieldsRow>
              <div className="min-w-0">
                <CadastroFieldLabel>Arquivo</CadastroFieldLabel>
                <div className="mt-1.5 flex flex-wrap items-center gap-6">
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="radio"
                      name="closure-export-format"
                      checked={format === 'pdf'}
                      onChange={() => setFormat('pdf')}
                      className={cadastroAccentControlCls}
                    />
                    <FileText size={16} className="text-gray-500 dark:text-gray-400" />
                    PDF
                  </label>
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="radio"
                      name="closure-export-format"
                      checked={format === 'excel'}
                      onChange={() => setFormat('excel')}
                      className={cadastroAccentControlCls}
                    />
                    <FileSpreadsheet size={16} className="text-gray-500 dark:text-gray-400" />
                    Excel
                  </label>
                </div>
              </div>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
        {typeof children === 'function' ? children(format) : children}
        {!hideAbsoluteOption && (
        <CadastroFormSection title="Opções" icon={<Download size={14} />} bodyClassName="p-0">
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
        )}
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
