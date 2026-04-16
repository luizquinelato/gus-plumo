/**
 * Cores padrão do Plumo
 * Paleta baseada no design do login: Azul, Roxo, Verde
 * Todas as cores foram validadas para acessibilidade WCAG AA
 */

export interface ColorScheme {
  color1: string // Azul vibrante
  color2: string // Verde vibrante
  color3: string // Teal escuro
  color4: string // Lavanda
  color5: string // Roxo escuro
  on_color1: string // Texto sobre color1
  on_color2: string // Texto sobre color2
  on_color3: string // Texto sobre color3
  on_color4: string // Texto sobre color4
  on_color5: string // Texto sobre color5
  on_gradient_1_2: string // Texto sobre gradiente 1-2
  on_gradient_2_3: string // Texto sobre gradiente 2-3
  on_gradient_3_4: string // Texto sobre gradiente 3-4
  on_gradient_4_5: string // Texto sobre gradiente 4-5
  on_gradient_5_1: string // Texto sobre gradiente 5-1
}

export interface ThemeColors {
  light: ColorScheme
  dark: ColorScheme
}

/**
 * Paleta padrão do Plumo - Modo Claro
 * Nova paleta 2026 otimizada para acessibilidade
 */
export const defaultLightColors: ColorScheme = {
  // Cores principais (nova paleta 2026)
  color1: '#297BFF', // Azul vibrante
  color2: '#0CC02A', // Verde vibrante
  color3: '#005F61', // Teal escuro
  color4: '#6F74B8', // Lavanda
  color5: '#220080', // Roxo escuro

  // Cores de texto sobre fundos coloridos (WCAG AA compliant)
  on_color1: '#FFFFFF', // Branco sobre azul
  on_color2: '#000000', // Preto sobre verde
  on_color3: '#FFFFFF', // Branco sobre teal
  on_color4: '#FFFFFF', // Branco sobre lavanda
  on_color5: '#FFFFFF', // Branco sobre roxo escuro

  // Cores de texto sobre gradientes
  on_gradient_1_2: '#000000', // Preto sobre azul-verde
  on_gradient_2_3: '#FFFFFF', // Branco sobre verde-teal
  on_gradient_3_4: '#FFFFFF', // Branco sobre teal-lavanda
  on_gradient_4_5: '#FFFFFF', // Branco sobre lavanda-roxo
  on_gradient_5_1: '#FFFFFF', // Branco sobre roxo-azul
}

/**
 * Paleta padrão do Plumo - Modo Escuro
 * Nova paleta 2026 (mesmas cores do light)
 */
export const defaultDarkColors: ColorScheme = {
  // Cores principais (mesmas do light mode)
  color1: '#297BFF', // Azul vibrante
  color2: '#0CC02A', // Verde vibrante
  color3: '#005F61', // Teal escuro
  color4: '#6F74B8', // Lavanda
  color5: '#220080', // Roxo escuro

  // Cores de texto sobre fundos coloridos
  on_color1: '#FFFFFF', // Branco sobre azul
  on_color2: '#000000', // Preto sobre verde
  on_color3: '#FFFFFF', // Branco sobre teal
  on_color4: '#FFFFFF', // Branco sobre lavanda
  on_color5: '#FFFFFF', // Branco sobre roxo escuro

  // Cores de texto sobre gradientes
  on_gradient_1_2: '#000000', // Preto sobre azul-verde
  on_gradient_2_3: '#FFFFFF', // Branco sobre verde-teal
  on_gradient_3_4: '#FFFFFF', // Branco sobre teal-lavanda
  on_gradient_4_5: '#FFFFFF', // Branco sobre lavanda-roxo
  on_gradient_5_1: '#FFFFFF', // Branco sobre roxo-azul
}

/**
 * Cores padrão completas (light + dark)
 */
export const defaultColors: ThemeColors = {
  light: defaultLightColors,
  dark: defaultDarkColors,
}

/**
 * Nomes amigáveis para as cores
 */
export const colorNames = {
  color1: 'Azul Vibrante',
  color2: 'Verde Vibrante',
  color3: 'Teal Profundo',
  color4: 'Lavanda Suave',
  color5: 'Roxo Intenso',
}

/**
 * Descrições das cores para ajudar na personalização
 */
export const colorDescriptions = {
  color1: 'Cor principal da marca - usada em botões primários e destaques',
  color2: 'Cor de sucesso - usada para feedback positivo e crescimento',
  color3: 'Cor de profundidade - usada em elementos importantes e sérios',
  color4: 'Cor de suavidade - usada em elementos de suporte e transições',
  color5: 'Cor de intensidade - usada em elementos de ação e dinamismo',
}

/**
 * Exemplos de uso das cores
 */
export const colorUsageExamples = {
  color1: ['Botões primários', 'Links importantes', 'Ícones de destaque'],
  color2: ['Mensagens de sucesso', 'Indicadores positivos', 'Gráficos de crescimento'],
  color3: ['Cabeçalhos', 'Navegação', 'Elementos de segurança'],
  color4: ['Botões secundários', 'Badges', 'Elementos decorativos'],
  color5: ['Fundos suaves', 'Cards', 'Elementos de apoio'],
}

/**
 * Validação mínima de contraste para cada tipo de uso
 */
export const minimumContrastRatios = {
  normalText: 4.5, // WCAG AA para texto normal
  largeText: 3.0, // WCAG AA para texto grande (18pt+ ou 14pt+ bold)
  uiComponents: 3.0, // WCAG AA para componentes de UI
  graphicalObjects: 3.0, // WCAG AA para objetos gráficos
}

/**
 * Tamanhos de fonte considerados "grandes" para WCAG
 */
export const largeFontSizes = {
  minPixels: 18,
  minPixelsBold: 14,
  minPoints: 18,
  minPointsBold: 14,
}

