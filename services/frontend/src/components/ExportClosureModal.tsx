import React, { useEffect, useState } from 'react'
import { X, Download, FileSpreadsheet, FileText } from 'lucide-react'

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

  // Reset to defaults when opening
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Download size={20} className="text-color-primary" />
            Exportar Fechamento
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Format selection */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Formato
          </label>
          <div className="flex gap-2 w-full">
            {([
              { key: 'pdf' as const, label: 'PDF', icon: <FileText size={16} />, activeClass: 'border-[var(--status-warning)] bg-[var(--status-warning)] text-white' },
              { key: 'excel' as const, label: 'Excel', icon: <FileSpreadsheet size={16} />, activeClass: 'border-green-600 bg-green-600 text-white' }
            ]).map(opt => (
              <button
                key={opt.key}
                onClick={() => setFormat(opt.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border-2 transition-all font-medium text-sm ${
                  format === opt.key
                    ? opt.activeClass
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Absolute values checkbox */}
        <div className="mb-6">
          <label className="flex items-center gap-2.5 cursor-pointer group w-fit">
            <input
              type="checkbox"
              checked={absoluteValues}
              onChange={e => setAbsoluteValues(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--color-1)] cursor-pointer"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 select-none group-hover:text-color-primary transition-colors">
              Valores absolutos
            </span>
          </label>
          <p className="mt-1.5 ml-6 text-xs text-gray-400 dark:text-gray-500">
            Remove os sinais +/− de todos os valores. As cores verde/vermelho são mantidas.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all font-medium text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={() => { onExport(format, absoluteValues); onClose() }}
            className="flex-1 py-2.5 rounded-xl bg-color-primary text-white hover:opacity-90 transition-all font-medium text-sm flex items-center justify-center gap-2"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </div>
    </div>
  )
}

