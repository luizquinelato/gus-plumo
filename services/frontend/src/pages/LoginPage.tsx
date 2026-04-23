import React, { useState, useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const { login, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()

  // Força background claro no body/html enquanto a página de login está montada,
  // impedindo que o tema dark vaze pelo body, html ou overscroll
  useEffect(() => {
    const savedBodyBg = document.body.style.backgroundColor
    const savedHtmlBg = document.documentElement.style.backgroundColor
    const savedColorScheme = document.documentElement.style.colorScheme

    document.body.style.backgroundColor = '#f8fafc'
    document.documentElement.style.backgroundColor = '#f8fafc'
    document.documentElement.style.colorScheme = 'light'

    return () => {
      document.body.style.backgroundColor = savedBodyBg
      document.documentElement.style.backgroundColor = savedHtmlBg
      document.documentElement.style.colorScheme = savedColorScheme
    }
  }, [])

  // Redirecionar se já estiver autenticado
  if (isAuthenticated) {
    // Se já tem conta selecionada, vai para home, senão vai para seleção de conta
    return <Navigate to={user?.account_id ? "/" : "/select-account"} replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const success = await login(email, password)
      if (success) {
        // Redirecionar para seleção de conta após login bem-sucedido
        navigate('/select-account')
      } else {
        setError('Email ou senha inválidos.')
      }
    } catch (error) {
      setError('Falha no login. Por favor, tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  // Cores default do sistema
  const colors = {
    color1: '#297BFF', // Azul
    color2: '#0CC02A', // Verde
    color3: '#005F61', // Teal Escuro
    color4: '#6F74B8', // Roxo Acinzentado
    color5: '#220080', // Roxo Profundo
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: `linear-gradient(to bottom right, #f8fafc, ${colors.color1}10, ${colors.color4}10)`, colorScheme: 'light' }}>
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Floating Cards */}
        <div className="absolute top-20 left-10 w-64 h-40 rounded-2xl backdrop-blur-sm transform rotate-12 animate-float" style={{ background: `linear-gradient(to bottom right, ${colors.color1}33, ${colors.color4}33)` }}></div>
        <div className="absolute top-40 right-20 w-48 h-32 rounded-2xl backdrop-blur-sm transform -rotate-6 animate-float-delayed" style={{ background: `linear-gradient(to bottom right, ${colors.color2}33, ${colors.color1}33)` }}></div>
        <div className="absolute bottom-32 left-1/4 w-56 h-36 rounded-2xl backdrop-blur-sm transform rotate-6 animate-float-slow" style={{ background: `linear-gradient(to bottom right, ${colors.color4}33, ${colors.color5}33)` }}></div>

        {/* Coin Icons */}
        <div className="absolute top-1/4 right-1/4 w-16 h-16 rounded-full animate-bounce-slow" style={{ backgroundColor: `${colors.color2}4D` }}></div>
        <div className="absolute bottom-1/3 right-1/3 w-12 h-12 rounded-full animate-bounce-delayed" style={{ backgroundColor: `${colors.color3}4D` }}></div>

        {/* Grid Pattern */}
        <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(${colors.color1}08 1px, transparent 1px), linear-gradient(90deg, ${colors.color1}08 1px, transparent 1px)`, backgroundSize: '50px 50px' }}></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo and Brand */}
          <div className="text-center mb-8">
            <div className="inline-block relative mb-6">
              {/* Rotating Border */}
              <div className="absolute inset-0 rounded-3xl animate-spin-slow opacity-75 blur-sm" style={{ background: `linear-gradient(to right, ${colors.color1}, ${colors.color4}, ${colors.color2})` }}></div>

              {/* Logo Container */}
              <div className="relative w-24 h-24 bg-white rounded-3xl shadow-2xl flex items-center justify-center">
                {/* Credit Card Icon */}
                <svg className="w-12 h-12" style={{ color: colors.color1 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>

                {/* Sparkle Effect */}
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow-lg animate-pulse" style={{ backgroundColor: colors.color2 }}>
                  <span className="text-white text-xs font-bold">$</span>
                </div>
              </div>
            </div>

            <h1 className="text-4xl font-bold bg-clip-text text-transparent mb-2" style={{ backgroundImage: `linear-gradient(to right, ${colors.color1}, ${colors.color2})` }}>
              Plumo
            </h1>
            <p className="text-slate-600 font-medium">Finanças leves, vida plena.</p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-3xl shadow-2xl p-8 border border-slate-200/50 backdrop-blur-xl">
            {/* Welcome Text */}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800 mb-1">Bem-vindo!</h2>
              <p className="text-slate-500 text-sm mb-3">Faça login para acessar sua conta</p>
              <p className="text-base font-semibold bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(to right, ${colors.color1}, ${colors.color2})` }}>
                Assuma a direção. Sinta a leveza.
              </p>
            </div>

            {/* Admin Notice */}
            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-xl animate-shake">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-red-800 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                  Email
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none email-icon">
                    <svg className="h-5 w-5 text-slate-400 transition-colors" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ '--focus-color': colors.color1 } as React.CSSProperties}
                    onFocus={(e) => { e.target.style.borderColor = colors.color1; e.target.style.boxShadow = `0 0 0 4px ${colors.color1}1A` }}
                    onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
                    placeholder="seu@email.com"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                  Senha
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none password-icon">
                    <svg className="h-5 w-5 text-slate-400 transition-colors" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onFocus={(e) => { e.target.style.borderColor = colors.color1; e.target.style.boxShadow = `0 0 0 4px ${colors.color1}1A` }}
                    onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setShowPassword(prev => !prev)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-6 py-4 px-6 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 relative overflow-hidden group"
                style={{ background: `linear-gradient(to right, ${colors.color1}, ${colors.color2})` }}
              >
                {/* Button Shine Effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>

                <span className="relative flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Entrando...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                      </svg>
                      Entrar na Plataforma
                    </>
                  )}
                </span>
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-slate-500 text-sm">
              © 2026 Plumo. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

