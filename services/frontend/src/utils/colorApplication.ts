/**
 * Color Application Utilities
 * 
 * Applies colors to the DOM using CSS custom properties.
 * Based on the health-pulse implementation.
 */

import { ColorData } from '../services/colorDataService'

/**
 * Calculate on-color (text color) for a given background color
 * Uses WCAG luminance calculation to determine if white or black text is more readable
 */
export function calculateOnColor(hex: string): string {
  try {
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    
    // Calculate relative luminance
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    
    // Calculate contrast ratios
    const contrast = (Lbg: number, Lfg: number) => (Math.max(Lbg, Lfg) + 0.05) / (Math.min(Lbg, Lfg) + 0.05)
    const cBlack = contrast(L, 0)
    const cWhite = contrast(L, 1)
    
    // Return color with better contrast
    return cWhite >= cBlack ? '#FFFFFF' : '#000000'
  } catch {
    return '#000000' // Fallback to black
  }
}

/**
 * Calculate on-color for a gradient (pair of colors)
 * Uses average luminance method
 */
export function calculateGradientOnColor(colorA: string, colorB: string): string {
  try {
    const getLuminance = (hex: string): number => {
      const h = hex.replace('#', '')
      const r = parseInt(h.slice(0, 2), 16) / 255
      const g = parseInt(h.slice(2, 4), 16) / 255
      const b = parseInt(h.slice(4, 6), 16) / 255
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    const luminanceA = getLuminance(colorA)
    const luminanceB = getLuminance(colorB)
    const averageLuminance = (luminanceA + luminanceB) / 2

    // Use 0.5 threshold on average luminance
    return averageLuminance < 0.5 ? '#FFFFFF' : '#000000'
  } catch {
    return '#FFFFFF' // Fallback to white for safety
  }
}

/**
 * Apply colors to DOM as CSS custom properties
 */
export function applyColorsToDOM(colorData: ColorData): void {
  const root = document.documentElement

  // Base colors
  root.style.setProperty('--color-1', colorData.color1)
  root.style.setProperty('--color-2', colorData.color2)
  root.style.setProperty('--color-3', colorData.color3)
  root.style.setProperty('--color-4', colorData.color4)
  root.style.setProperty('--color-5', colorData.color5)

  // On-colors (text colors for solid backgrounds)
  root.style.setProperty('--on-color-1', colorData.on_color1)
  root.style.setProperty('--on-color-2', colorData.on_color2)
  root.style.setProperty('--on-color-3', colorData.on_color3)
  root.style.setProperty('--on-color-4', colorData.on_color4)
  root.style.setProperty('--on-color-5', colorData.on_color5)

  // On-gradient colors (text colors for gradient backgrounds)
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
export function getCurrentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Load and apply colors from colorDataService
 */
export function loadAndApplyColors(
  _mode: 'default' | 'custom',
  _theme: 'light' | 'dark',
  _accessibility: 'regular' | 'AA' | 'AAA' = 'regular'
): boolean {
  // This will be implemented when we integrate with colorDataService
  // For now, just return false
  return false
}

