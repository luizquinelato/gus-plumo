/**
 * Unified Color Customizer Component
 *
 * Features:
 * - Toggle between Default and Custom color schemes
 * - Default mode: Colors are locked and cannot be edited
 * - Custom mode: Full editing capabilities for both light and dark themes
 * - Real-time preview of on-colors and gradient colors
 * - 3 accessibility levels (Regular, AA, AAA) with automatic calculation
 * - Unified save: One click saves all 12 combinations (2 themes × 2 modes × 3 levels)
 */

import React, { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, Save, Sun, Moon, Lock, Palette } from 'lucide-react'
import { useColorData } from '../hooks/useColorData'
import { colorNames, colorDescriptions, defaultColors } from '../config/defaultColors'
import { isValidHex, normalizeHex } from '../utils/colorUtils'
import { calculateVariantsForAllLevels } from '../utils/colorCalculations'
import ColorVariantsPreview from './ColorVariantsPreview'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface ColorInputProps {
  label: string
  description: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  icon?: React.ReactNode
}

const ColorInput: React.FC<ColorInputProps> = ({ label, description, value, onChange, disabled = false, icon }) => {
  const [localValue, setLocalValue] = useState(value)
  const [isValid, setIsValid] = useState(true)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return

    const newValue = e.target.value
    setLocalValue(newValue)

    if (isValidHex(newValue)) {
      setIsValid(true)
      onChange(normalizeHex(newValue))
    } else {
      setIsValid(false)
    }
  }

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <div className="flex-1">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 sm:mt-1">
            {description}
          </p>
        </div>
        {disabled && (
          <Lock className="w-3 h-3 sm:w-4 sm:h-4 text-gray-400" />
        )}
      </div>

      <div className="flex gap-2 sm:gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={localValue}
            onChange={handleChange}
            disabled={disabled}
            className={`
              w-full px-2 sm:px-3 py-1.5 sm:py-2 border rounded-md font-mono text-xs sm:text-sm
              ${isValid
                ? 'border-gray-300 dark:border-gray-600'
                : 'border-red-500 dark:border-red-400'
              }
              ${disabled
                ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed opacity-60'
                : 'bg-white dark:bg-gray-700'
              }
              text-gray-900 dark:text-white
              focus:outline-none focus:ring-2 focus:ring-blue-500
            `}
            placeholder="#000000"
          />
          {!isValid && !disabled && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              Cor inválida. Use formato #RRGGBB
            </p>
          )}
        </div>

        <input
          type="color"
          value={value}
          onChange={(e) => !disabled && onChange(normalizeHex(e.target.value))}
          disabled={disabled}
          className={`w-12 h-8 sm:w-16 sm:h-10 rounded-md cursor-pointer border border-gray-300 dark:border-gray-600 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />

        <div
          className="w-12 h-8 sm:w-16 sm:h-10 rounded-md border border-gray-300 dark:border-gray-600"
          style={{ backgroundColor: value }}
        />
      </div>
    </div>
  )
}

const ColorCustomizerUnified: React.FC = () => {
  const { isLoading, updateColors } = useColorData()
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [isLoadingMode, setIsLoadingMode] = useState(true)
  const [savedMode, setSavedMode] = useState<boolean>(false) // Track the mode saved in DB

  // Light theme colors (nova paleta 2026)
  const [lightColors, setLightColors] = useState({
    color1: '#297BFF',
    color2: '#0CC02A',
    color3: '#005F61',
    color4: '#6F74B8',
    color5: '#220080'
  })

  // Dark theme colors (nova paleta 2026)
  const [darkColors, setDarkColors] = useState({
    color1: '#297BFF',
    color2: '#0CC02A',
    color3: '#005F61',
    color4: '#6F74B8',
    color5: '#220080'
  })

  // Load current mode and colors from backend
  useEffect(() => {
    const loadCurrentColors = async () => {
      try {
        setIsLoadingMode(true)

        // Load all colors from unified endpoint
        const response = await axios.get(`${API_BASE_URL}/api/tenant/colors/unified`)

        if (response.data.success) {
          // Get current mode from tenant
          const isCustom = response.data.color_schema_mode === 'custom'
          setIsCustomMode(isCustom)
          setSavedMode(isCustom) // Save the mode from DB

          // Find light and dark colors for the current mode
          const colors = response.data.colors

          // Find light colors
          const lightColorData = colors.find((c: any) =>
            c.color_schema_mode === response.data.color_schema_mode &&
            c.theme_mode === 'light' &&
            c.accessibility_level === 'regular'
          )

          if (lightColorData) {
            setLightColors({
              color1: lightColorData.color1 || defaultColors.light.color1,
              color2: lightColorData.color2 || defaultColors.light.color2,
              color3: lightColorData.color3 || defaultColors.light.color3,
              color4: lightColorData.color4 || defaultColors.light.color4,
              color5: lightColorData.color5 || defaultColors.light.color5,
            })
          }

          // Find dark colors
          const darkColorData = colors.find((c: any) =>
            c.color_schema_mode === response.data.color_schema_mode &&
            c.theme_mode === 'dark' &&
            c.accessibility_level === 'regular'
          )

          if (darkColorData) {
            setDarkColors({
              color1: darkColorData.color1 || defaultColors.dark.color1,
              color2: darkColorData.color2 || defaultColors.dark.color2,
              color3: darkColorData.color3 || defaultColors.dark.color3,
              color4: darkColorData.color4 || defaultColors.dark.color4,
              color5: darkColorData.color5 || defaultColors.dark.color5,
            })
          }
        }
      } catch (error) {
        console.error('Error loading colors:', error)
        // Use defaults on error
        setIsCustomMode(false)
        setSavedMode(false)
      } finally {
        setIsLoadingMode(false)
      }
    }

    loadCurrentColors()
  }, [])

  // Calculate variants in real-time
  const lightVariants = calculateVariantsForAllLevels(lightColors)
  const darkVariants = calculateVariantsForAllLevels(darkColors)

  const handleLightColorChange = (key: string, value: string) => {
    if (!isCustomMode) return // Don't allow changes in default mode
    setLightColors(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleDarkColorChange = (key: string, value: string) => {
    if (!isCustomMode) return // Don't allow changes in default mode
    setDarkColors(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const switchToDefaultMode = () => {
    setIsCustomMode(false)

    // Load default colors from localStorage (via colorDataService)
    const cachedColors = localStorage.getItem('gus_expenses_color_data')
    if (cachedColors) {
      try {
        const allColors = JSON.parse(cachedColors)

        // Find default light colors
        const lightColorData = allColors.find((c: any) =>
          c.color_schema_mode === 'default' &&
          c.theme_mode === 'light' &&
          c.accessibility_level === 'regular'
        )

        if (lightColorData) {
          setLightColors({
            color1: lightColorData.color1,
            color2: lightColorData.color2,
            color3: lightColorData.color3,
            color4: lightColorData.color4,
            color5: lightColorData.color5,
          })
        }

        // Find default dark colors
        const darkColorData = allColors.find((c: any) =>
          c.color_schema_mode === 'default' &&
          c.theme_mode === 'dark' &&
          c.accessibility_level === 'regular'
        )

        if (darkColorData) {
          setDarkColors({
            color1: darkColorData.color1,
            color2: darkColorData.color2,
            color3: darkColorData.color3,
            color4: darkColorData.color4,
            color5: darkColorData.color5,
          })
        }

      } catch (error) {
        console.error('Error parsing cached colors:', error)
      }
    }

    // Check if mode changed from saved mode
    if (savedMode !== false) {
      setHasChanges(true) // Enable save button because mode changed
    } else {
      setHasChanges(false) // No changes, already in default mode in DB
    }
  }

  const switchToCustomMode = () => {
    setIsCustomMode(true)

    // Load custom colors from localStorage (via colorDataService)
    const cachedColors = localStorage.getItem('gus_expenses_color_data')
    if (cachedColors) {
      try {
        const allColors = JSON.parse(cachedColors)

        // Find custom light colors
        const lightColorData = allColors.find((c: any) =>
          c.color_schema_mode === 'custom' &&
          c.theme_mode === 'light' &&
          c.accessibility_level === 'regular'
        )

        if (lightColorData) {
          setLightColors({
            color1: lightColorData.color1,
            color2: lightColorData.color2,
            color3: lightColorData.color3,
            color4: lightColorData.color4,
            color5: lightColorData.color5,
          })
        }

        // Find custom dark colors
        const darkColorData = allColors.find((c: any) =>
          c.color_schema_mode === 'custom' &&
          c.theme_mode === 'dark' &&
          c.accessibility_level === 'regular'
        )

        if (darkColorData) {
          setDarkColors({
            color1: darkColorData.color1,
            color2: darkColorData.color2,
            color3: darkColorData.color3,
            color4: darkColorData.color4,
            color5: darkColorData.color5,
          })
        }

      } catch (error) {
        console.error('Error parsing cached colors:', error)
      }
    }

    // Check if mode changed from saved mode
    if (savedMode !== true) {
      setHasChanges(true) // Enable save button because mode changed
    } else {
      setHasChanges(false) // No changes, already in custom mode in DB
    }
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)

      if (isCustomMode) {
        // 1. Save custom colors
        await updateColors(lightColors, darkColors)

        // 2. Update tenant color_schema_mode to 'custom'
        await axios.post(`${API_BASE_URL}/api/tenant/colors/mode`, {
          mode: 'custom'
        })

        // 3. Update localStorage
        localStorage.setItem('gus_expenses_color_mode', 'custom')

        setSavedMode(true) // Update saved mode
      } else {
        // Just update tenant color_schema_mode to 'default'
        // No need to reset colors, just change the mode
        await axios.post(`${API_BASE_URL}/api/tenant/colors/mode`, {
          mode: 'default'
        })

        // Update localStorage
        localStorage.setItem('gus_expenses_color_mode', 'default')

        setSavedMode(false) // Update saved mode
      }

      setHasChanges(false)

      // Reload colors from backend and update localStorage
      const response = await axios.get(`${API_BASE_URL}/api/tenant/colors/unified`)
      if (response.data.success) {
        const colors = response.data.colors

        // Update localStorage with new colors
        localStorage.setItem('gus_expenses_color_data', JSON.stringify(colors))
        localStorage.setItem('gus_expenses_color_data_timestamp', Date.now().toString())
      }

      // Dispatch event to apply new colors immediately (no page reload needed)
      window.dispatchEvent(new CustomEvent('colorDataLoaded'))
    } catch (error) {
      console.error('Error saving:', error)
      alert('Erro ao salvar. Tente novamente.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading || isLoadingMode) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="ml-3 text-gray-600 dark:text-gray-400">Carregando cores...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
      {/* Header with Mode Selection */}
      <div className="space-y-3 sm:space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
              Personalização de Cores
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              {isCustomMode
                ? 'Modo Personalizado - Edite as cores do tema claro e escuro'
                : 'Modo Padrão - Usando cores padrão do Plumo'}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
            >
              <Save className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{isSaving ? 'Salvando...' : 'Salvar'}</span>
              <span className="sm:hidden">{isSaving ? '...' : 'Salvar'}</span>
            </button>
          </div>
        </div>

        {/* Mode Selection Buttons - Melhorado com mais destaque */}
        <div className="flex gap-2 sm:gap-3 p-1 sm:p-1.5 bg-white dark:bg-gray-800 rounded-lg w-full sm:w-fit border-2 border-gray-200 dark:border-gray-700 shadow-sm">
          <button
            onClick={switchToDefaultMode}
            disabled={isSaving || !isCustomMode}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all ${
              !isCustomMode
                ? 'shadow-md scale-105'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            style={!isCustomMode ? {
              background: 'var(--gradient-1-2)',
              color: 'var(--on-gradient-1-2)'
            } : undefined}
          >
            <Lock className="w-3 h-3 sm:w-4 sm:h-4" />
            Padrão
          </button>

          <button
            onClick={switchToCustomMode}
            disabled={isSaving || isCustomMode}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all ${
              isCustomMode
                ? 'shadow-md scale-105'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            style={isCustomMode ? {
              background: 'var(--gradient-1-2)',
              color: 'var(--on-gradient-1-2)'
            } : undefined}
          >
            <Palette className="w-3 h-3 sm:w-4 sm:h-4" />
            Personalizado
          </button>
        </div>
      </div>

      {/* Mode Info Banner */}
      {!isCustomMode && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4">
          <div className="flex gap-2 sm:gap-3">
            <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Modo Padrão Ativo</p>
              <p className="text-blue-700 dark:text-blue-300">
                As cores estão bloqueadas e não podem ser editadas. Clique em "Personalizado" acima para ativar o modo personalizado e editar as cores.
              </p>
            </div>
          </div>
        </div>
      )}

      {isCustomMode && (
        <div
          className="rounded-lg p-3 sm:p-4 border"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-2) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-2) 30%, transparent)'
          }}
        >
          <div className="flex gap-2 sm:gap-3">
            <Palette className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-2)' }} />
            <div className="text-xs sm:text-sm">
              <p className="font-medium mb-1 text-gray-900 dark:text-white">Modo Personalizado Ativo</p>
              <p className="text-gray-700 dark:text-gray-300">
                Edite as cores abaixo. As cores de texto (on-colors) e gradientes são calculadas automaticamente para garantir acessibilidade.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Color Editors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
        {/* Light Theme */}
        <div className={`bg-white rounded-lg p-4 sm:p-6 border shadow-sm ${
          isCustomMode ? 'border-gray-200' : 'border-gray-300 bg-gray-50'
        }`}>
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
            <h4 className="text-base sm:text-lg font-semibold text-gray-900">
              Tema Claro
            </h4>
            {!isCustomMode && (
              <span className="ml-auto text-xs text-gray-500 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span className="hidden sm:inline">Bloqueado</span>
              </span>
            )}
          </div>

          <div className="space-y-4 sm:space-y-6">
            {(['color1', 'color2', 'color3', 'color4', 'color5'] as const).map((colorKey) => (
              <ColorInput
                key={colorKey}
                label={colorNames[colorKey]}
                description={colorDescriptions[colorKey]}
                value={lightColors[colorKey]}
                onChange={(value) => handleLightColorChange(colorKey, value)}
                disabled={!isCustomMode}
              />
            ))}
          </div>
        </div>

        {/* Dark Theme */}
        <div className={`bg-gray-900 rounded-lg p-4 sm:p-6 border shadow-sm ${
          isCustomMode ? 'border-gray-700' : 'border-gray-600 opacity-75'
        }`}>
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            <h4 className="text-base sm:text-lg font-semibold text-white">
              Tema Escuro
            </h4>
            {!isCustomMode && (
              <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span className="hidden sm:inline">Bloqueado</span>
              </span>
            )}
          </div>

          <div className="space-y-4 sm:space-y-6">
            {(['color1', 'color2', 'color3', 'color4', 'color5'] as const).map((colorKey) => (
              <ColorInput
                key={colorKey}
                label={colorNames[colorKey]}
                description={colorDescriptions[colorKey]}
                value={darkColors[colorKey]}
                onChange={(value) => handleDarkColorChange(colorKey, value)}
                disabled={!isCustomMode}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Variants Preview - Show for both modes */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4 sm:p-6 mt-4 sm:mt-6 lg:mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg w-fit">
            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h4 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              Visualização de Cores Calculadas
            </h4>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              Veja como as cores de texto (on-colors) e gradientes são calculadas automaticamente para os 3 níveis de acessibilidade
            </p>
          </div>
        </div>
      </div>

      <ColorVariantsPreview
        lightColors={lightColors}
        darkColors={darkColors}
        lightVariants={lightVariants}
        darkVariants={darkVariants}
      />

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4">
        <div className="flex gap-2 sm:gap-3">
          <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">💡 Como funciona:</p>
            <ul className="list-disc list-inside space-y-0.5 sm:space-y-1 text-blue-700 dark:text-blue-300">
              <li><strong>Modo Padrão:</strong> Usa as cores padrão do Plumo (não editável)</li>
              <li><strong>Modo Personalizado:</strong> Permite editar cores para temas claro e escuro</li>
              <li><strong>On-colors:</strong> Cores de texto calculadas automaticamente para garantir legibilidade</li>
              <li><strong>Gradientes:</strong> Cores de texto em gradientes calculadas automaticamente</li>
              <li><strong>3 níveis de acessibilidade:</strong> Regular, AA (4.5:1), AAA (7:1)</li>
              <li><strong>Salvar:</strong> Um clique salva todas as 12 combinações (2 temas × 2 modos × 3 níveis)</li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  )
}

export default ColorCustomizerUnified

