import React, { useState, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import { Calendar, X } from 'lucide-react'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/custom-date-modal.css'

interface CustomDateFilterModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (startDate: Date, endDate: Date) => void
  initialStartDate?: Date | null
  initialEndDate?: Date | null
}

const CustomDateFilterModal: React.FC<CustomDateFilterModalProps> = ({
  isOpen,
  onClose,
  onApply,
  initialStartDate: _initialStartDate,
  initialEndDate: _initialEndDate
}) => {
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)

  // Limpa as datas quando o modal abre (sempre começa vazio)
  useEffect(() => {
    if (isOpen) {
      setStartDate(null)
      setEndDate(null)
    }
  }, [isOpen])

  // Atalhos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        handleApply()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, startDate, endDate])

  const handleApply = () => {
    if (startDate && endDate) {
      onApply(startDate, endDate)
      onClose()
    }
  }

  const onChange = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates
    setStartDate(start)
    setEndDate(end)
  }

  const handleQuickSelect = (type: string) => {
    const now = new Date()
    let start: Date
    let end: Date = now

    switch (type) {
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case '3months':
        start = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate())
        break
      case '6months':
        start = new Date(now.getFullYear(), now.getMonth() - 5, now.getDate())
        break
      case 'ytd':
        start = new Date(now.getFullYear(), 0, 1)
        break
      case '1year':
        start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
        break
      case '5years':
        start = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
        break
      default:
        return
    }

    setStartDate(start)
    setEndDate(end)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Filtro Personalizado
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5">
          {/* Quick Select Buttons */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Atalhos Rápidos
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleQuickSelect('month')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                Mês Atual
              </button>
              <button
                onClick={() => handleQuickSelect('3months')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                3 Meses
              </button>
              <button
                onClick={() => handleQuickSelect('6months')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                6 Meses
              </button>
              <button
                onClick={() => handleQuickSelect('ytd')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                YTD
              </button>
              <button
                onClick={() => handleQuickSelect('1year')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                1 Ano
              </button>
              <button
                onClick={() => handleQuickSelect('5years')}
                className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
              >
                5 Anos
              </button>
            </div>
          </div>

          {/* Date Range Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Ou Selecione Manualmente
            </label>
            <div className="flex justify-center w-full">
              <DatePicker
                selected={startDate}
                onChange={onChange}
                startDate={startDate}
                endDate={endDate}
                selectsRange
                dateFormat="dd/MM/yyyy"
                placeholderText="Clique para selecionar data inicial e final..."
                monthsShown={2}
                inline
                calendarClassName="custom-calendar-full-width"
              />
            </div>
          </div>

          {/* Info */}
          {startDate && endDate && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Período selecionado: <span className="font-semibold">{startDate.toLocaleDateString('pt-BR')}</span> até{' '}
                <span className="font-semibold">{endDate.toLocaleDateString('pt-BR')}</span>
              </p>
            </div>
          )}
          {startDate && !endDate && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                📅 Selecione a data final para completar o período
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleApply}
            disabled={!startDate || !endDate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Aplicar Filtro
          </button>
        </div>
      </div>
    </div>
  )
}

export default CustomDateFilterModal

