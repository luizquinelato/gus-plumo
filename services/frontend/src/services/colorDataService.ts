/**
 * Complete Color Data Management Service
 * 
 * This service manages all color data (12 combinations per tenant) in localStorage
 * for instant access and flash-free color application.
 * 
 * Architecture:
 * - Singleton pattern for global state management
 * - localStorage cache with 24h TTL
 * - Single API call loads all 12 combinations
 * - Instant access without network requests
 */

export interface ColorData {
  color_schema_mode: 'default' | 'custom'
  theme_mode: 'light' | 'dark'
  accessibility_level: 'regular' | 'AA' | 'AAA'
  color1: string
  color2: string
  color3: string
  color4: string
  color5: string
  on_color1: string
  on_color2: string
  on_color3: string
  on_color4: string
  on_color5: string
  on_gradient_1_2: string
  on_gradient_2_3: string
  on_gradient_3_4: string
  on_gradient_4_5: string
  on_gradient_5_1: string
}

export interface ColorSchema {
  color1: string
  color2: string
  color3: string
  color4: string
  color5: string
}

export interface ColorVariants {
  on_color1: string
  on_color2: string
  on_color3: string
  on_color4: string
  on_color5: string
  on_gradient_1_2: string
  on_gradient_2_3: string
  on_gradient_3_4: string
  on_gradient_4_5: string
  on_gradient_5_1: string
}

const STORAGE_KEY = 'gus_expenses_color_data'
const CACHE_TIMESTAMP_KEY = 'gus_expenses_color_data_timestamp'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export class ColorDataService {
  private static instance: ColorDataService
  private colorData: ColorData[] = []
  private isLoaded = false

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ColorDataService {
    if (!ColorDataService.instance) {
      ColorDataService.instance = new ColorDataService()
    }
    return ColorDataService.instance
  }

  /**
   * Load complete color data from localStorage
   */
  private loadFromCache(): boolean {
    try {
      const cached = localStorage.getItem(STORAGE_KEY)
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)

      if (!cached || !timestamp) {
        return false
      }

      const age = Date.now() - parseInt(timestamp)
      if (age > CACHE_TTL) {
        this.clearCache()
        return false
      }

      this.colorData = JSON.parse(cached)
      this.isLoaded = true
      return true
    } catch (error) {
      console.warn('🎨 Failed to load cached color data:', error)
      this.clearCache()
      return false
    }
  }

  /**
   * Save complete color data to localStorage
   */
  saveToCache(colorData: ColorData[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(colorData))
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
      this.colorData = colorData
      this.isLoaded = true
    } catch (error) {
      console.error('Failed to cache color data:', error)
    }
  }

  /**
   * Clear cached color data
   */
  clearCache(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(CACHE_TIMESTAMP_KEY)
      this.colorData = []
      this.isLoaded = false
    } catch (error) {
      console.warn('Failed to clear color cache:', error)
    }
  }

  /**
   * Get specific color combination (base colors only)
   */
  getColors(
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorSchema | null {
    // Load from cache if not already loaded
    if (!this.isLoaded) {
      this.loadFromCache()
    }

    const colorData = this.colorData.find(c =>
      c.color_schema_mode === mode &&
      c.theme_mode === theme &&
      c.accessibility_level === accessibility
    )

    if (!colorData) {
      console.warn(`🎨 Color combination not found: ${mode}/${theme}/${accessibility}`)
      return null
    }

    return {
      color1: colorData.color1,
      color2: colorData.color2,
      color3: colorData.color3,
      color4: colorData.color4,
      color5: colorData.color5
    }
  }

  /**
   * Get specific color combination (variants only)
   */
  getVariants(
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorVariants | null {
    // Load from cache if not already loaded
    if (!this.isLoaded) {
      this.loadFromCache()
    }

    const colorData = this.colorData.find(c =>
      c.color_schema_mode === mode &&
      c.theme_mode === theme &&
      c.accessibility_level === accessibility
    )

    if (!colorData) {
      console.warn(`🎨 Color variants not found: ${mode}/${theme}/${accessibility}`)
      return null
    }

    return {
      on_color1: colorData.on_color1,
      on_color2: colorData.on_color2,
      on_color3: colorData.on_color3,
      on_color4: colorData.on_color4,
      on_color5: colorData.on_color5,
      on_gradient_1_2: colorData.on_gradient_1_2,
      on_gradient_2_3: colorData.on_gradient_2_3,
      on_gradient_3_4: colorData.on_gradient_3_4,
      on_gradient_4_5: colorData.on_gradient_4_5,
      on_gradient_5_1: colorData.on_gradient_5_1
    }
  }

  /**
   * Get complete color data (base + variants)
   */
  getCompleteColorData(
    mode: 'default' | 'custom',
    theme: 'light' | 'dark',
    accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
  ): ColorData | null {
    // Load from cache if not already loaded
    if (!this.isLoaded) {
      this.loadFromCache()
    }

    const colorData = this.colorData.find(c =>
      c.color_schema_mode === mode &&
      c.theme_mode === theme &&
      c.accessibility_level === accessibility
    )

    if (!colorData) {
      console.warn(`🎨 Complete color data not found: ${mode}/${theme}/${accessibility}`)
      return null
    }

    return colorData
  }

  /**
   * Get all color data (all 12 combinations)
   */
  getAllColorData(): ColorData[] {
    // Load from cache if not already loaded
    if (!this.isLoaded) {
      this.loadFromCache()
    }

    return this.colorData
  }

  /**
   * Check if color data is loaded
   */
  isDataLoaded(): boolean {
    return this.isLoaded
  }

  /**
   * Force reload from cache
   */
  reloadFromCache(): boolean {
    this.isLoaded = false
    return this.loadFromCache()
  }
}

// Export singleton instance
export const colorDataService = ColorDataService.getInstance()

