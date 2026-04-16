/**
 * Color Application Service
 * 
 * Applies colors to the DOM using CSS custom properties.
 * Works with the unified color system.
 */

import { ColorData } from './colorDataService'

export class ColorApplicationService {
  private static instance: ColorApplicationService

  private constructor() {}

  static getInstance(): ColorApplicationService {
    if (!ColorApplicationService.instance) {
      ColorApplicationService.instance = new ColorApplicationService()
    }
    return ColorApplicationService.instance
  }

  /**
   * Apply colors to DOM as CSS custom properties
   */
  applyColors(colorData: ColorData): void {
    const root = document.documentElement

    // Base colors
    root.style.setProperty('--color-1', colorData.color1)
    root.style.setProperty('--color-2', colorData.color2)
    root.style.setProperty('--color-3', colorData.color3)
    root.style.setProperty('--color-4', colorData.color4)
    root.style.setProperty('--color-5', colorData.color5)

    // On-colors (text colors)
    root.style.setProperty('--on-color-1', colorData.on_color1)
    root.style.setProperty('--on-color-2', colorData.on_color2)
    root.style.setProperty('--on-color-3', colorData.on_color3)
    root.style.setProperty('--on-color-4', colorData.on_color4)
    root.style.setProperty('--on-color-5', colorData.on_color5)

    // Gradient on-colors
    root.style.setProperty('--on-gradient-1-2', colorData.on_gradient_1_2)
    root.style.setProperty('--on-gradient-2-3', colorData.on_gradient_2_3)
    root.style.setProperty('--on-gradient-3-4', colorData.on_gradient_3_4)
    root.style.setProperty('--on-gradient-4-5', colorData.on_gradient_4_5)
    root.style.setProperty('--on-gradient-5-1', colorData.on_gradient_5_1)

    // Gradient backgrounds
    root.style.setProperty('--gradient-1-2', `linear-gradient(135deg, ${colorData.color1}, ${colorData.color2})`)
    root.style.setProperty('--gradient-2-3', `linear-gradient(135deg, ${colorData.color2}, ${colorData.color3})`)
    root.style.setProperty('--gradient-3-4', `linear-gradient(135deg, ${colorData.color3}, ${colorData.color4})`)
    root.style.setProperty('--gradient-4-5', `linear-gradient(135deg, ${colorData.color4}, ${colorData.color5})`)
    root.style.setProperty('--gradient-5-1', `linear-gradient(135deg, ${colorData.color5}, ${colorData.color1})`)
    root.style.setProperty('--gradient-full', `linear-gradient(135deg, ${colorData.color1}, ${colorData.color2}, ${colorData.color3}, ${colorData.color4}, ${colorData.color5})`)
  }

  /**
   * Get current theme from DOM
   */
  getCurrentTheme(): 'light' | 'dark' {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  }
}

// Export singleton instance
export const colorApplicationService = ColorApplicationService.getInstance()

