/**
 * Color Calculation Utilities (Frontend)
 * 
 * Mirrors backend ColorCalculationService for client-side preview.
 * Used to show calculated variants before saving to backend.
 */

/**
 * Calculate WCAG relative luminance
 */
export function calculateLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  const linearize = (c: number) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/**
 * Calculate WCAG contrast ratio
 */
export function calculateContrastRatio(color1: string, color2: string): number {
  const l1 = calculateLuminance(color1)
  const l2 = calculateLuminance(color2)

  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)

  return (light + 0.05) / (dark + 0.05)
}

/**
 * Pick optimal text color (black or white) for background
 */
export function pickOnColor(backgroundColor: string, threshold: number = 0.5): string {
  const luminance = calculateLuminance(backgroundColor)
  return luminance < threshold ? '#FFFFFF' : '#000000'
}

/**
 * Pick optimal text color for gradient
 */
export function pickGradientOnColor(
  colorA: string,
  colorB: string,
  threshold: number = 0.5
): string {
  const onA = pickOnColor(colorA, threshold)
  const onB = pickOnColor(colorB, threshold)

  // If both need same color, use it
  if (onA === onB) {
    return onA
  }

  // Use average luminance method
  const luminanceA = calculateLuminance(colorA)
  const luminanceB = calculateLuminance(colorB)
  const averageLuminance = (luminanceA + luminanceB) / 2

  return averageLuminance < threshold ? '#FFFFFF' : '#000000'
}

/**
 * Darken a color by a factor
 */
export function darkenColor(hexColor: string, factor: number): string {
  const hex = hexColor.replace('#', '')
  let r = parseInt(hex.substring(0, 2), 16)
  let g = parseInt(hex.substring(2, 4), 16)
  let b = parseInt(hex.substring(4, 6), 16)

  r = Math.max(0, Math.floor(r * (1 - factor)))
  g = Math.max(0, Math.floor(g * (1 - factor)))
  b = Math.max(0, Math.floor(b * (1 - factor)))

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

/**
 * Apply accessibility enhancement
 */
export function applyAccessibilityEnhancement(
  hexColor: string,
  level: 'regular' | 'AA' | 'AAA'
): string {
  if (level === 'AAA') {
    return darkenColor(hexColor, 0.1)
  } else if (level === 'AA') {
    return darkenColor(hexColor, 0.05)
  }
  return hexColor
}

/**
 * Calculate all variants for a color set
 */
export function calculateAllVariants(
  baseColors: Record<string, string>,
  threshold: number = 0.5
): Record<string, string> {
  const variants: Record<string, string> = {}

  // Calculate on-colors
  for (let i = 1; i <= 5; i++) {
    const colorKey = `color${i}`
    if (baseColors[colorKey]) {
      variants[`on_color${i}`] = pickOnColor(baseColors[colorKey], threshold)
    }
  }

  // Calculate gradient on-colors
  const gradientPairs = [
    ['color1', 'color2', 'on_gradient_1_2'],
    ['color2', 'color3', 'on_gradient_2_3'],
    ['color3', 'color4', 'on_gradient_3_4'],
    ['color4', 'color5', 'on_gradient_4_5'],
    ['color5', 'color1', 'on_gradient_5_1']
  ]

  for (const [colorAKey, colorBKey, gradientKey] of gradientPairs) {
    if (baseColors[colorAKey] && baseColors[colorBKey]) {
      variants[gradientKey] = pickGradientOnColor(
        baseColors[colorAKey],
        baseColors[colorBKey],
        threshold
      )
    }
  }

  return variants
}

/**
 * Calculate variants for all accessibility levels
 */
export function calculateVariantsForAllLevels(
  baseColors: Record<string, string>,
  threshold: number = 0.5
): {
  regular: Record<string, string>
  AA: Record<string, string>
  AAA: Record<string, string>
} {
  const levels = ['regular', 'AA', 'AAA'] as const

  const result: any = {}

  for (const level of levels) {
    const enhancedColors: Record<string, string> = {}

    // Apply enhancement to base colors
    for (let i = 1; i <= 5; i++) {
      const colorKey = `color${i}`
      if (baseColors[colorKey]) {
        enhancedColors[colorKey] = applyAccessibilityEnhancement(
          baseColors[colorKey],
          level
        )
      }
    }

    // Calculate variants for this level
    result[level] = calculateAllVariants(enhancedColors, threshold)
  }

  return result
}

