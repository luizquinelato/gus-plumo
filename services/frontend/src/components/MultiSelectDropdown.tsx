import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Target } from 'lucide-react'

interface Option<T = number> {
  id: T
  name: string
  count?: number
  icon?: React.ReactNode
  color?: string
  groupKey?: string // Chave para agrupamento (ex: tag_name)
  groupName?: string // Nome do grupo para exibição
}

interface MultiSelectDropdownProps<T = number> {
  label: string
  options: Option<T>[]
  selectedIds: T[]
  onChange: (selectedIds: T[]) => void
  placeholder?: string
  icon?: React.ReactNode
  showOnlyButton?: boolean // Mostrar botão "Apenas" em cada opção
  groupByKey?: boolean // Se true, agrupa opções por groupKey
  disabled?: boolean // Se true, desabilita o dropdown
}

// Componente para IDs numéricos (compatibilidade com código existente)
export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps<number>> = ({
  label: _label,
  options,
  selectedIds,
  onChange,
  placeholder = 'Selecione...',
  icon,
  showOnlyButton = true,
  groupByKey = false,
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredOptionId, setHoveredOptionId] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const toggleOption = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(selectedId => selectedId !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const selectOnly = (id: number) => {
    onChange([id])
  }

  const selectAll = () => {
    onChange(options.map(opt => opt.id))
  }

  const clearAll = () => {
    onChange([])
  }

  const getDisplayText = () => {
    if (selectedIds.length === 0) return placeholder
    if (selectedIds.length === options.length) return 'Todos'
    if (selectedIds.length === 1) {
      const selected = options.find(opt => opt.id === selectedIds[0])
      return selected?.name || placeholder
    }
    return `${selectedIds.length} selecionados`
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-gray-400 dark:hover:border-gray-500'}`}
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          <span className="truncate">{getDisplayText()}</span>
        </span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-[9999] mt-1 min-w-full w-max bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col">
          {/* Header com ações */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {selectedIds.length} de {options.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
              >
                Todos
              </button>
              <span className="text-xs text-gray-400">|</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
              >
                Limpar
              </button>
            </div>
          </div>

          {/* Lista de opções */}
          <div className="overflow-y-auto max-h-80">
            {options.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                Nenhuma opção disponível
              </div>
            ) : groupByKey && options.some(opt => opt.groupKey) ? (
              // Renderização agrupada
              (() => {
                // Agrupa opções por groupKey
                const groups: { key: string; name: string; options: Option<number>[] }[] = []
                const groupMap = new Map<string, Option<number>[]>()

                options.forEach(option => {
                  const key = option.groupKey || '_ungrouped'
                  if (!groupMap.has(key)) {
                    groupMap.set(key, [])
                    groups.push({
                      key,
                      name: option.groupName || option.groupKey || 'Outros',
                      options: groupMap.get(key)!
                    })
                  }
                  groupMap.get(key)!.push(option)
                })

                return groups.map((group, groupIndex) => (
                  <div key={group.key}>
                    {/* Header do grupo */}
                    <div className={`sticky top-0 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600 ${groupIndex > 0 ? 'border-t' : ''}`}>
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                        {group.name}
                      </span>
                    </div>
                    {/* Opções do grupo */}
                    {group.options.map(option => (
                      <div
                        key={option.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors group"
                        onMouseEnter={() => setHoveredOptionId(option.id)}
                        onMouseLeave={() => setHoveredOptionId(null)}
                      >
                        <label className="flex items-center gap-3 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(option.id)}
                            onChange={() => toggleOption(option.id)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                          />
                          {option.icon && (
                            <span className="flex-shrink-0" style={option.color ? { color: option.color } : {}}>
                              {option.icon}
                            </span>
                          )}
                          <span className="flex-1 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                            {option.name}
                          </span>
                          {option.count !== undefined && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                              ({option.count})
                            </span>
                          )}
                        </label>
                        {/* Botão "Apenas" - aparece no hover */}
                        {showOnlyButton && options.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectOnly(option.id)
                            }}
                            className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded transition-all ${
                              hoveredOptionId === option.id
                                ? 'opacity-100 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40'
                                : 'opacity-0'
                            }`}
                            title={`Selecionar apenas "${option.name}"`}
                          >
                            <Target size={12} className="inline mr-0.5" />
                            Apenas
                          </button>
                        )}
                        {selectedIds.includes(option.id) && (
                          <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                ))
              })()
            ) : (
              // Renderização simples (sem agrupamento)
              options.map(option => (
                <div
                  key={option.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors group"
                  onMouseEnter={() => setHoveredOptionId(option.id)}
                  onMouseLeave={() => setHoveredOptionId(null)}
                >
                  <label className="flex items-center gap-3 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(option.id)}
                      onChange={() => toggleOption(option.id)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    />
                    {option.icon && (
                      <span className="flex-shrink-0" style={option.color ? { color: option.color } : {}}>
                        {option.icon}
                      </span>
                    )}
                    <span className="flex-1 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                      {option.name}
                    </span>
                    {option.count !== undefined && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                        ({option.count})
                      </span>
                    )}
                  </label>
                  {/* Botão "Apenas" - aparece no hover */}
                  {showOnlyButton && options.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectOnly(option.id)
                      }}
                      className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded transition-all ${
                        hoveredOptionId === option.id
                          ? 'opacity-100 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40'
                          : 'opacity-0'
                      }`}
                      title={`Selecionar apenas "${option.name}"`}
                    >
                      <Target size={12} className="inline mr-0.5" />
                      Apenas
                    </button>
                  )}
                  {selectedIds.includes(option.id) && (
                    <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Componente para IDs string (para fonte de dados)
interface StringOption {
  id: string
  name: string
  icon?: React.ReactNode
  color?: string
}

interface StringMultiSelectDropdownProps {
  label: string
  options: StringOption[]
  selectedIds: string[]
  onChange: (selectedIds: string[]) => void
  placeholder?: string
  icon?: React.ReactNode
  showOnlyButton?: boolean
}

export const SourceMultiSelectDropdown: React.FC<StringMultiSelectDropdownProps> = ({
  label: _label,
  options,
  selectedIds,
  onChange,
  placeholder = 'Selecione...',
  icon,
  showOnlyButton = true
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredOptionId, setHoveredOptionId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const toggleOption = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(selectedId => selectedId !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const selectOnly = (id: string) => {
    onChange([id])
  }

  const selectAll = () => {
    onChange(options.map(opt => opt.id))
  }

  const clearAll = () => {
    onChange([])
  }

  const getDisplayText = () => {
    if (selectedIds.length === 0) return placeholder
    if (selectedIds.length === options.length) return 'Todos'
    if (selectedIds.length === 1) {
      const selected = options.find(opt => opt.id === selectedIds[0])
      return selected?.name || placeholder
    }
    return `${selectedIds.length} selecionados`
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          <span className="truncate">{getDisplayText()}</span>
        </span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-[9999] mt-1 min-w-full w-max bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-96 overflow-hidden flex flex-col">
          {/* Header com ações */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {selectedIds.length} de {options.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
              >
                Todos
              </button>
              <span className="text-xs text-gray-400">|</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
              >
                Limpar
              </button>
            </div>
          </div>

          {/* Lista de opções */}
          <div className="overflow-y-auto max-h-80">
            {options.map(option => (
              <div
                key={option.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors group"
                onMouseEnter={() => setHoveredOptionId(option.id)}
                onMouseLeave={() => setHoveredOptionId(null)}
              >
                <label className="flex items-center gap-3 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(option.id)}
                    onChange={() => toggleOption(option.id)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  {option.icon && (
                    <span className="flex-shrink-0" style={option.color ? { color: option.color } : {}}>
                      {option.icon}
                    </span>
                  )}
                  <span className="flex-1 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                    {option.name}
                  </span>
                </label>
                {/* Botão "Apenas" - aparece no hover */}
                {showOnlyButton && options.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectOnly(option.id)
                    }}
                    className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded transition-all ${
                      hoveredOptionId === option.id
                        ? 'opacity-100 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40'
                        : 'opacity-0'
                    }`}
                    title={`Selecionar apenas "${option.name}"`}
                  >
                    <Target size={12} className="inline mr-0.5" />
                    Apenas
                  </button>
                )}
                {selectedIds.includes(option.id) && (
                  <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
