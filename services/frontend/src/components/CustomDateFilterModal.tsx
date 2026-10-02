import React, { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { DateCalendar } from './date'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'

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

  useEffect(() => {
    if (isOpen) {
      setStartDate(null)
      setEndDate(null)
    }
  }, [isOpen])

  const handleApply = () => {
    if (startDate && endDate) {
      onApply(startDate, endDate)
      onClose()
    }
  }

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

  const handleRangeChange = (start: Date | null, end: Date | null) => {
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

  const shortcuts = [
    { key: 'month', label: 'Mês atual' },
    { key: '3months', label: '3 meses' },
    { key: '6months', label: '6 meses' },
    { key: 'ytd', label: 'YTD' },
    { key: '1year', label: '1 ano' },
    { key: '5years', label: '5 anos' },
  ]

  return (
    <CadastroModalShell maxWidth="max-w-3xl" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title="Filtro personalizado"
        subtitle="Escolha um atalho ou selecione o intervalo no calendário"
        onClose={onClose}
        icon={<Calendar size={18} />}
      />
      <CadastroModalBody>
        <CadastroFormSection title="Atalhos rápidos" icon={<Calendar size={14} />}>
          <div className="grid grid-cols-3 gap-2">
            {shortcuts.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => handleQuickSelect(item.key)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:border-[var(--color-1)] hover:text-[var(--color-1)] dark:border-gray-600 dark:text-gray-300"
              >
                {item.label}
              </button>
            ))}
          </div>
        </CadastroFormSection>
        <CadastroFormSection title="Período" icon={<Calendar size={14} />}>
          <div className="flex w-full justify-center">
            <DateCalendar
              mode="range"
              rangeStart={startDate}
              rangeEnd={endDate}
              onRangeChange={handleRangeChange}
              onClear={() => handleRangeChange(null, null)}
              monthsShown={2}
              variant="inline"
            />
          </div>
          {startDate && endDate ? (
            <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              Período selecionado: {startDate.toLocaleDateString('pt-BR')} até {endDate.toLocaleDateString('pt-BR')}
            </p>
          ) : startDate ? (
            <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              Selecione a data final para completar o período
            </p>
          ) : null}
        </CadastroFormSection>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={handleApply}
        disabled={!startDate || !endDate}
        saveLabel="Aplicar filtro"
      />
    </CadastroModalShell>
  )
}

export default CustomDateFilterModal
