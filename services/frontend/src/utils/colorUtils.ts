/**
 * Utilitários para cálculo de cores e acessibilidade WCAG
 * Baseado nas diretrizes WCAG 2.1 para contraste de cores
 */

/**
 * Converte cor hexadecimal para RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * Converte RGB para hexadecimal
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(x).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

/**
 * Calcula a luminância relativa de uma cor (WCAG 2.1)
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(val => {
    const sRGB = val / 255
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Calcula o contraste entre duas cores (WCAG 2.1)
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getRelativeLuminance(color1)
  const lum2 = getRelativeLuminance(color2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Verifica se o contraste atende aos padrões WCAG
 */
export interface ContrastCheck {
  ratio: number
  AA: boolean // 4.5:1 para texto normal, 3:1 para texto grande
  AAA: boolean // 7:1 para texto normal, 4.5:1 para texto grande
  AALarge: boolean // 3:1 para texto grande
  AAALarge: boolean // 4.5:1 para texto grande
}

export function checkContrast(foreground: string, background: string): ContrastCheck {
  const ratio = getContrastRatio(foreground, background)
  
  return {
    ratio,
    AA: ratio >= 4.5,
    AAA: ratio >= 7,
    AALarge: ratio >= 3,
    AAALarge: ratio >= 4.5,
  }
}

/**
 * Retorna a melhor cor de texto (preto ou branco) para um fundo
 */
export function getAccessibleTextColor(backgroundColor: string): string {
  const whiteContrast = getContrastRatio('#FFFFFF', backgroundColor)
  const blackContrast = getContrastRatio('#000000', backgroundColor)
  
  return whiteContrast > blackContrast ? '#FFFFFF' : '#000000'
}

/**
 * Escurece uma cor em uma porcentagem
 */
export function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex

  const factor = 1 - (percent / 100)
  return rgbToHex(
    rgb.r * factor,
    rgb.g * factor,
    rgb.b * factor
  )
}

/**
 * Clareia uma cor em uma porcentagem
 */
export function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex

  const factor = percent / 100
  return rgbToHex(
    rgb.r + (255 - rgb.r) * factor,
    rgb.g + (255 - rgb.g) * factor,
    rgb.b + (255 - rgb.b) * factor
  )
}

/**
 * Cria uma cor intermediária entre duas cores (gradiente)
 */
export function blendColors(color1: string, color2: string, ratio: number = 0.5): string {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  
  if (!rgb1 || !rgb2) return color1

  return rgbToHex(
    rgb1.r + (rgb2.r - rgb1.r) * ratio,
    rgb1.g + (rgb2.g - rgb1.g) * ratio,
    rgb1.b + (rgb2.b - rgb1.b) * ratio
  )
}

/**
 * Valida se uma cor hex é válida
 */
export function isValidHex(hex: string): boolean {
  return /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex)
}

/**
 * Normaliza cor hex (adiciona # se necessário e converte para 6 dígitos)
 */
export function normalizeHex(hex: string): string {
  let normalized = hex.trim()
  
  // Adiciona # se não tiver
  if (!normalized.startsWith('#')) {
    normalized = '#' + normalized
  }
  
  // Converte 3 dígitos para 6
  if (normalized.length === 4) {
    normalized = '#' + normalized[1] + normalized[1] + normalized[2] + normalized[2] + normalized[3] + normalized[3]
  }
  
  return normalized.toUpperCase()
}

