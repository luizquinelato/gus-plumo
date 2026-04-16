/**
 * Color Variants Preview Component
 * 
 * Shows calculated on-colors and gradient colors for both light and dark themes.
 * Displays all 3 accessibility levels (regular, AA, AAA) side by side.
 */

import React from 'react'
import { CheckCircle } from 'lucide-react'

interface ColorVariantsPreviewProps {
  lightColors: Record<string, string>
  darkColors: Record<string, string>
  lightVariants: {
    regular: Record<string, string>
    AA: Record<string, string>
    AAA: Record<string, string>
  }
  darkVariants: {
    regular: Record<string, string>
    AA: Record<string, string>
    AAA: Record<string, string>
  }
}

const ColorVariantsPreview: React.FC<ColorVariantsPreviewProps> = ({
  lightColors,
  darkColors,
  lightVariants,
  darkVariants
}) => {
  const renderColorBox = (
    bgColor: string,
    textColor: string,
    label: string
  ) => (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-lg flex items-center justify-center text-base sm:text-lg font-bold shadow-md"
        style={{ backgroundColor: bgColor, color: textColor }}
      >
        Aa
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">
        {label}
      </span>
    </div>
  )

  const renderGradientBox = (
    colorA: string,
    colorB: string,
    textColor: string,
    label: string
  ) => (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-lg flex items-center justify-center text-base sm:text-lg font-bold shadow-md"
        style={{
          background: `linear-gradient(135deg, ${colorA}, ${colorB})`,
          color: textColor
        }}
      >
        Aa
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">
        {label}
      </span>
    </div>
  )

  const renderThemeCard = (
    title: string,
    bgClass: string,
    colors: Record<string, string>,
    variants: {
      regular: Record<string, string>
      AA: Record<string, string>
      AAA: Record<string, string>
    }
  ) => (
    <div className={`${bgClass} rounded-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700`}>
      <h4 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 text-gray-900 dark:text-white">
        {title}
      </h4>

      {/* Regular Level */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-2 sm:mb-3">
          <h5 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
            Regular
          </h5>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            (Standard contrast)
          </span>
        </div>

        {/* On-Colors */}
        <div className="mb-3 sm:mb-4">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">On-Colors</p>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {[1, 2, 3, 4, 5].map(num => (
              <div key={`regular-on-color-${num}`}>
                {renderColorBox(
                  colors[`color${num}`],
                  variants.regular[`on_color${num}`],
                  `C${num}`
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Gradients */}
        <div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Gradients</p>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            <div key="regular-gradient-1-2">{renderGradientBox(colors.color1, colors.color2, variants.regular.on_gradient_1_2, '1→2')}</div>
            <div key="regular-gradient-2-3">{renderGradientBox(colors.color2, colors.color3, variants.regular.on_gradient_2_3, '2→3')}</div>
            <div key="regular-gradient-3-4">{renderGradientBox(colors.color3, colors.color4, variants.regular.on_gradient_3_4, '3→4')}</div>
            <div key="regular-gradient-4-5">{renderGradientBox(colors.color4, colors.color5, variants.regular.on_gradient_4_5, '4→5')}</div>
            <div key="regular-gradient-5-1">{renderGradientBox(colors.color5, colors.color1, variants.regular.on_gradient_5_1, '5→1')}</div>
          </div>
        </div>
      </div>

      {/* AA Level */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-2 sm:mb-3">
          <h5 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
            AA Level
          </h5>
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="w-3 h-3" />
            WCAG AA (4.5:1)
          </span>
        </div>

        <div className="mb-3 sm:mb-4">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">On-Colors</p>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {[1, 2, 3, 4, 5].map(num => (
              <div key={`aa-on-color-${num}`}>
                {renderColorBox(
                  colors[`color${num}`],
                  variants.AA[`on_color${num}`],
                  `C${num}`
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AAA Level */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-2 sm:mb-3">
          <h5 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
            AAA Level
          </h5>
          <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
            <CheckCircle className="w-3 h-3" />
            WCAG AAA (7:1)
          </span>
        </div>

        <div className="mb-3 sm:mb-4">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">On-Colors</p>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {[1, 2, 3, 4, 5].map(num => (
              <div key={`aaa-on-color-${num}`}>
                {renderColorBox(
                  colors[`color${num}`],
                  variants.AAA[`on_color${num}`],
                  `C${num}`
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
      {renderThemeCard('Tema Claro', 'bg-white', lightColors, lightVariants)}
      {renderThemeCard('Tema Escuro', 'bg-gray-900', darkColors, darkVariants)}
    </div>
  )
}

export default ColorVariantsPreview

