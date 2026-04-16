import React from 'react'
import { Palette } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import ColorCustomizerUnified from '../components/ColorCustomizerUnified'

const ColorSettingsPage: React.FC = () => {
  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="w-full">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
              <Palette className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600" />
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white">
                Personalização de Cores
              </h1>
            </div>
            <p className="text-sm sm:text-base lg:text-lg text-gray-600 dark:text-gray-400">
              Personalize as cores da sua aplicação para temas claro e escuro. As cores serão aplicadas em toda a interface com 3 níveis de acessibilidade (Regular, AA, AAA).
            </p>
          </div>

          {/* Color Customizer Unified */}
          <ColorCustomizerUnified />

          {/* Info Section - Moved after ColorCustomizerUnified */}

          {/* Color Usage Guide */}
          <div className="mt-4 sm:mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">
              🎨 Guia de Uso das Cores
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
                <h4 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
                  Cor 1 - Azul Vibrante
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 sm:mb-2">
                  Cor principal da marca
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-0.5 sm:space-y-1">
                  <li>• Botões primários</li>
                  <li>• Links importantes</li>
                  <li>• Ícones de destaque</li>
                </ul>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
                <h4 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
                  Cor 2 - Verde Vibrante
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 sm:mb-2">
                  Cor de sucesso
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-0.5 sm:space-y-1">
                  <li>• Mensagens de sucesso</li>
                  <li>• Indicadores positivos</li>
                  <li>• Gráficos de crescimento</li>
                </ul>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
                <h4 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
                  Cor 3 - Teal Profundo
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 sm:mb-2">
                  Cor de profundidade
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-0.5 sm:space-y-1">
                  <li>• Cabeçalhos</li>
                  <li>• Navegação</li>
                  <li>• Elementos de segurança</li>
                </ul>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
                <h4 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
                  Cor 4 - Lavanda Suave
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 sm:mb-2">
                  Cor de suavidade
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-0.5 sm:space-y-1">
                  <li>• Botões secundários</li>
                  <li>• Badges</li>
                  <li>• Elementos decorativos</li>
                </ul>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
                <h4 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
                  Cor 5 - Roxo Intenso
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1 sm:mb-2">
                  Cor de intensidade
                </p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-0.5 sm:space-y-1">
                  <li>• Fundos suaves</li>
                  <li>• Cards</li>
                  <li>• Elementos de apoio</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default ColorSettingsPage

