import { Feather } from 'lucide-react'

interface LoadingSpinnerProps {
  message?: string
  size?: 'sm' | 'md' | 'lg'
  fullScreen?: boolean
}

const LoadingSpinner = ({
  message = 'Carregando...',
  size = 'md',
  fullScreen = false
}: LoadingSpinnerProps) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-14 h-14'
  }

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  }

  const content = (
    <div className="text-center">
      <div className="relative inline-flex items-center justify-center">
        {/* Círculo pulsante de fundo */}
        <div
          className="absolute rounded-full bg-color-primary-light animate-ping"
          style={{
            width: size === 'sm' ? '24px' : size === 'md' ? '40px' : '56px',
            height: size === 'sm' ? '24px' : size === 'md' ? '40px' : '56px',
            opacity: 0.4
          }}
        />
        {/* Pena com animação de balanço */}
        <div className="relative animate-feather-float">
          <Feather
            className={`${sizeClasses[size]} text-color-primary drop-shadow-sm`}
            strokeWidth={1.5}
          />
        </div>
      </div>
      {message && (
        <p className={`text-gray-500 dark:text-gray-400 mt-3 ${textSizeClasses[size]}`}>
          {message}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="flex-1 flex items-center justify-center">
        {content}
      </div>
    )
  }

  return content
}

export default LoadingSpinner

