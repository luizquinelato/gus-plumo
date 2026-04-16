import React, { useState } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { Filter } from 'lucide-react'

interface TagOption {
  id: number
  name: string
}

interface SubtagOption {
  id: number
  name: string
  tag_id: number
  tag_name: string
}

interface PartnerOption {
  id: number
  partner_name: string
}

interface ReportFiltersProps {
  // Estados
  sourceBank: boolean
  setSourceBank: (value: boolean) => void
  sourceCards: boolean
  setSourceCards: (value: boolean) => void
  periodType: 'month' | '3months' | '6months' | 'ytd' | '1year' | '5years' | 'custom'
  setPeriodType: (value: 'month' | '3months' | '6months' | 'ytd' | '1year' | '5years' | 'custom') => void
  startDate: Date | null
  setStartDate: (value: Date | null) => void
  endDate: Date | null
  setEndDate: (value: Date | null) => void
  selectedTagId: number | null
  setSelectedTagId: (value: number | null) => void
  selectedSubtagId: number | null
  setSelectedSubtagId: (value: number | null) => void
  selectedPartnerId: number | null
  setSelectedPartnerId: (value: number | null) => void

  // Opções
  tags: TagOption[]
  subtags: SubtagOption[]
  partners: PartnerOption[]

  // Funções
  onClearFilters: () => void
}

const ReportFilters: React.FC<ReportFiltersProps> = ({
  sourceBank,
  setSourceBank,
  sourceCards,
  setSourceCards,
  periodType,
  setPeriodType,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  selectedTagId,
  setSelectedTagId,
  selectedSubtagId,
  setSelectedSubtagId,
  selectedPartnerId,
  setSelectedPartnerId,
  tags,
  subtags,
  partners,
  onClearFilters
}) => {
  const [showFilters, setShowFilters] = useState(false)

  // Filtra subtags baseado na tag selecionada
  const filteredSubtags = selectedTagId
    ? subtags.filter(st => st.tag_id === selectedTagId)
    : subtags

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg p-6 mb-6 border border-gray-200 dark:border-gray-700"
      style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Filter className="w-5 h-5" />
          Filtros
        </h3>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          {showFilters ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {showFilters && (
        <div className="space-y-4">
          {/* Fonte de Dados */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Fonte de Dados
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={sourceBank}
                  onChange={(e) => setSourceBank(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Extratos Bancários
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={sourceCards}
                  onChange={(e) => setSourceCards(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Cartões de Crédito
                </span>
              </label>
            </div>
          </div>

          {/* Filtros em uma linha */}
          <div className="flex flex-wrap gap-4 items-end">
            {/* Período */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Período
              </label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as any)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="month">Mês Atual</option>
                <option value="3months">Últimos 3 Meses</option>
                <option value="6months">Últimos 6 Meses</option>
                <option value="ytd">Ano Corrente (YTD)</option>
                <option value="1year">Último Ano</option>
                <option value="5years">Últimos 5 Anos</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            {/* Data Inicial (só aparece se custom) */}
            {periodType === 'custom' && (
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Data Inicial
                </label>
                <DatePicker
                  selected={startDate}
                  onChange={(date: Date | null) => setStartDate(date)}
                  dateFormat="dd/MM/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholderText="Selecione..."
                />
              </div>
            )}

            {/* Data Final (só aparece se custom) */}
            {periodType === 'custom' && (
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Data Final
                </label>
                <DatePicker
                  selected={endDate}
                  onChange={(date: Date | null) => setEndDate(date)}
                  dateFormat="dd/MM/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                  placeholderText="Selecione..."
                />
              </div>
            )}

            {/* Tag */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Tag
              </label>
              <select
                value={selectedTagId || ''}
                onChange={(e) => {
                  setSelectedTagId(e.target.value ? parseInt(e.target.value) : null)
                  setSelectedSubtagId(null) // Limpa subtag ao mudar tag
                }}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="">Todas</option>
                {tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subtag */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Subtag
              </label>
              <select
                value={selectedSubtagId || ''}
                onChange={(e) => setSelectedSubtagId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                disabled={filteredSubtags.length === 0}
              >
                <option value="">Todas</option>
                {filteredSubtags.map(subtag => (
                  <option key={subtag.id} value={subtag.id}>
                    {subtag.name} {!selectedTagId && `(${subtag.tag_name})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Parceiro */}
            <div className="flex-1 min-w-[180px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Parceiro
              </label>
              <select
                value={selectedPartnerId || ''}
                onChange={(e) => setSelectedPartnerId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="">Todos</option>
                {partners.map(partner => (
                  <option key={partner.id} value={partner.id}>
                    {partner.partner_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Botão Limpar Filtros */}
          <div className="flex justify-end">
            <button
              onClick={onClearFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Limpar Filtros
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ReportFilters
