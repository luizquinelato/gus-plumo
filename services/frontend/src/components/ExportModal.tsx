import { useState, useEffect } from 'react'
import { X, Download, Files, FileSpreadsheet, Users } from 'lucide-react'
import { ExpenseExportData, exportToExcel, exportToExcelSeparado, ExportOptions } from '../utils/exportToExcel'

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

  // Atalhos de teclado
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

  // Conta quantos registros têm compartilhamento
  const sharedCount = expenses.filter(e => e.shared_partner_name).length

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-color-primary" />
            Exportar para Excel
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Info */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{expenses.length}</span> transações serão exportadas
            </p>
          </div>

          {/* Modo de Exportação */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Formato de Exportação
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <input
                  type="radio"
                  name="exportMode"
                  value="single"
                  checked={exportMode === 'single'}
                  onChange={() => setExportMode('single')}
                  className="w-4 h-4 text-color-primary"
                />
                <Download size={18} className="text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Arquivo Único</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">1 arquivo Excel com 3 abas</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <input
                  type="radio"
                  name="exportMode"
                  value="separate"
                  checked={exportMode === 'separate'}
                  onChange={() => setExportMode('separate')}
                  className="w-4 h-4 text-color-primary"
                />
                <Files size={18} className="text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Arquivos Separados</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">3 arquivos individuais (extratos, faturas, benefícios)</p>
                </div>
              </label>
            </div>
          </div>

          {/* Opção de Compartilhamento */}
          <div>
            <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
              <input
                type="checkbox"
                checked={includeSharing}
                onChange={(e) => setIncludeSharing(e.target.checked)}
                className="w-4 h-4 text-color-primary rounded"
              />
              <Users size={18} className="text-gray-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Incluir Compartilhamento</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Adiciona colunas: Conta Parceira, Minha Contribuição (%)
                  {sharedCount > 0 && (
                    <span className="ml-1 text-color-primary">• {sharedCount} com compartilhamento</span>
                  )}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--crud-cancel)' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium text-white bg-color-primary hover:opacity-90 rounded-lg transition-opacity flex items-center gap-2"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </div>
    </div>
  )
}

