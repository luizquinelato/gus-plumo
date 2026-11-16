import React, { useEffect, useState } from 'react'
import { Check, ChevronRight, Download, FileSpreadsheet, FileText } from 'lucide-react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
} from './CadastroFormLayout'

interface ExportClosureModalProps {
  isOpen: boolean
  onClose: () => void
  /** Volta ao menu do hub sem encerrar o fluxo (X/backdrop usam onClose). */
  onBack?: () => void
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

function hubRowBtnCls(selected: boolean) {
  return selected
    ? 'flex w-full items-center gap-3 rounded-lg border border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_8%,white)] px-3 py-2.5 text-left transition-colors dark:bg-[color-mix(in_srgb,var(--color-1)_12%,#111827)] dark:border-[var(--color-1)]'
    : 'flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-[var(--color-1)] hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700/50'
}

export const ExportClosureModal: React.FC<ExportClosureModalProps> = ({
  isOpen,
  onClose,
  onBack,
  onExport,
  title = 'Exportar fechamento',
  subtitle = 'Escolha o formato do arquivo',
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
        if (onBack) onBack()
        else onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, format, absoluteValues, onClose, onExport, onBack])

  if (!isOpen) return null

  const formatRows: {
    id: 'pdf' | 'excel'
    label: string
    hint: string
    icon: React.ReactNode
  }[] = [
    {
      id: 'pdf',
      label: 'PDF',
      hint: 'Relatório para visualizar e imprimir',
      icon: <FileText size={18} className="shrink-0 text-[var(--color-1)]" />,
    },
    {
      id: 'excel',
      label: 'Excel',
      hint: 'Planilha para editar e consolidar',
      icon: <FileSpreadsheet size={18} className="shrink-0 text-[var(--color-1)]" />,
    },
  ]

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
        {summary ? <div className="mb-4">{summary}</div> : null}

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Formato</p>
        <div className="flex flex-col gap-2">
          {formatRows.map((row) => {
            const selected = format === row.id
            return (
              <button
                key={row.id}
                type="button"
                className={hubRowBtnCls(selected)}
                onClick={() => setFormat(row.id)}
              >
                {row.icon}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{row.hint}</span>
                </span>
                {selected ? (
                  <Check size={16} className="shrink-0 text-[var(--color-1)]" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-gray-400" />
                )}
              </button>
            )
          })}
        </div>

        {typeof children === 'function' ? (
          <div className="mt-4">{children(format)}</div>
        ) : children ? (
          <div className="mt-4">{children}</div>
        ) : null}

        {!hideAbsoluteOption && (
          <>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Opções
            </p>
            <button
              type="button"
              className={hubRowBtnCls(absoluteValues)}
              onClick={() => setAbsoluteValues((v) => !v)}
            >
              <Download size={18} className="shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">Valores absolutos</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Remove os sinais +/−; mantém as cores verde e vermelho
                </span>
              </span>
              <input
                type="checkbox"
                checked={absoluteValues}
                readOnly
                tabIndex={-1}
                className={`${cadastroAccentControlCls} pointer-events-none h-4 w-4 shrink-0 rounded border-gray-300`}
                aria-hidden
              />
            </button>
          </>
        )}
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onBack={onBack}
        closeLabel="Fechar"
        onSave={() => {
          onExport(format, absoluteValues)
          if (onBack) {
            onBack()
          } else {
            onClose()
          }
        }}
        saveLabel="Exportar"
        saveIcon={<Download size={15} />}
      />
    </CadastroModalShell>
  )
}