/**
 * React Hook for Color Data Management
 * 
 * Provides easy access to color data with automatic loading and caching.
 * Integrates with ColorDataService for unified color management.
 */

import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { colorDataService, ColorData, ColorSchema, ColorVariants } from '../services/colorDataService'

interface UseColorDataReturn {
  isLoading: boolean
  error: string | null
  colorData: ColorData[]
  loadColors: () => Promise<void>
  getColors: (mode: 'default' | 'custom', theme: 'light' | 'dark', accessibility?: 'regular' | 'AA' | 'AAA') => ColorSchema | null
  getVariants: (mode: 'default' | 'custom', theme: 'light' | 'dark', accessibility?: 'regular' | 'AA' | 'AAA') => ColorVariants | null
  getCompleteColorData: (mode: 'default' | 'custom', theme: 'light' | 'dark', accessibility?: 'regular' | 'AA' | 'AAA') => ColorData | null
  updateColors: (lightColors: Record<string, string>, darkColors: Record<string, string>) => Promise<void>
  clearCache: () => void
}

export const useColorData = (): UseColorDataReturn => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [colorData, setColorData] = useState<ColorData[]>([])

  /**
   * Load all color data from API or cache
   */
  const loadColors = useCallback(async () => {
    // Check if already loaded from cache
    if (colorDataService.isDataLoaded()) {
      setColorData(colorDataService.getAllColorData())
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Try to load from cache first
      const cachedData = colorDataService.getAllColorData()
      if (cachedData.length > 0) {
        setColorData(cachedData)
        setIsLoading(false)
        return
      }

      // Load from API
      const response = await axios.get('/api/tenant/colors/unified')
      
      if (response.data.success) {
        const colors = response.data.colors as ColorData[]

        // Save to cache
        colorDataService.saveToCache(colors)
        setColorData(colors)

        console.log('🎨 Loaded', colors.length, 'color combinations from API')

        // Dispatch event to notify color application hook
        window.dispatchEvent(new CustomEvent('colorDataLoaded'))
      } else {
        throw new Error('Failed to load color data')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error loading colors'
      setError(errorMessage)
      console.error('🎨 Error loading color data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Update colors via unified endpoint
   */
  const updateColors = useCallback(async (
    lightColors: Record<string, string>,
    darkColors: Record<string, string>
  ) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await axios.post('/api/tenant/colors/unified', {
        light_colors: lightColors,
        dark_colors: darkColors
      })

      if (response.data.success) {
        // Reload colors from API to get fresh data
        const freshResponse = await axios.get('/api/tenant/colors/unified')

        if (freshResponse.data.success) {
          const colors = freshResponse.data.colors as ColorData[]

          // Update cache and state
          colorDataService.clearCache()
          colorDataService.saveToCache(colors)
          setColorData(colors)

          // Dispatch event to apply colors immediately
          window.dispatchEvent(new CustomEvent('colorDataLoaded'))

          console.log('🎨 Colors updated and applied successfully')
        }
      } else {
        throw new Error('Failed to update colors')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error updating colors'
      setError(errorMessage)
      console.error('🎨 Error updating colors:', err)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Get colors for specific combination
   */
  const getColors = useCallback((
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorSchema | null => {
    return colorDataService.getColors(mode, theme, accessibility)
  }, [])

  /**
   * Get variants for specific combination
   */
  const getVariants = useCallback((
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorVariants | null => {
    return colorDataService.getVariants(mode, theme, accessibility)
  }, [])

  /**
   * Get complete color data for specific combination
   */
  const getCompleteColorData = useCallback((
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorData | null => {
    return colorDataService.getCompleteColorData(mode, theme, accessibility)
  }, [])

  /**
   * Clear cache
   */
  const clearCache = useCallback(() => {
    colorDataService.clearCache()
    setColorData([])
  }, [])

  // Auto-load on mount
  useEffect(() => {
    loadColors()
  }, [loadColors])

  return {
    isLoading,
    error,
    colorData,
    loadColors,
    getColors,
    getVariants,
    getCompleteColorData,
    updateColors,
    clearCache
  }
}

