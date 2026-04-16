/**
 * Hook for applying colors to the DOM
 * 
 * This hook integrates with useColorData and applies colors to CSS variables
 * whenever the color mode, theme, or accessibility level changes.
 */

import { useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { colorDataService } from '../services/colorDataService'
import { applyColorsToDOM } from '../utils/colorApplication'

export function useColorApplication() {
  const { theme } = useTheme()

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    // Get current color mode from tenant (will be loaded via API)
    const applyCurrentColors = () => {
      try {
        // Try to load from colorDataService
        const colorData = colorDataService.getAllColorData()

        if (colorData.length === 0) {
          return
        }

        // Get tenant's color_schema_mode from localStorage (set during login)
        const colorMode = (localStorage.getItem('gus_expenses_color_mode') as 'default' | 'custom') || 'default'

        // Find the appropriate color data
        const currentColorData = colorData.find(c =>
          c.color_schema_mode === colorMode &&
          c.theme_mode === theme &&
          c.accessibility_level === 'regular'
        )

        if (currentColorData) {
          applyColorsToDOM(currentColorData)
        } else {
          console.warn('🎨 No color data found for:', { mode: colorMode, theme })
        }
      } catch (error) {
        console.error('🎨 Error applying colors:', error)
      }
    }

    // Apply colors immediately
    applyCurrentColors()

    // Listen for color data changes with debounce
    const handleColorDataChange = () => {
      // Clear any pending timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Debounce to avoid multiple rapid applications
      timeoutId = setTimeout(() => {
        applyCurrentColors()
      }, 100)
    }

    window.addEventListener('colorDataLoaded', handleColorDataChange)

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      window.removeEventListener('colorDataLoaded', handleColorDataChange)
    }
  }, [theme])
}

