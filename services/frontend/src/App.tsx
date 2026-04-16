import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import SelectAccountPage from './pages/SelectAccountPage'
import HomePage from './pages/HomePage'
import CartoesPage from './pages/CartoesPage'
import ContasPage from './pages/ContasPage'
import CompartilhamentosPage from './pages/CompartilhamentosPage'
import ColorSettingsPage from './pages/ColorSettingsPage'
import SettingsPage from './pages/SettingsPage'
import MappingsPage from './pages/MappingsPage'
import ExtratoPage from './pages/ExtratoPage'
import BalancoPage from './pages/BalancoPage'
import FaturasPage from './pages/FaturasPage'
import CuradoriaPage from './pages/CuradoriaPage'
import TagsSubtagsPage from './pages/TagsSubtagsPage'
import ExpenseTemplatesPage from './pages/ExpenseTemplatesPage'
import GrupoPage from './pages/GrupoPage'
import EmprestimosPage from './pages/EmprestimosPage'
import ProfilePage from './pages/ProfilePage'
import { useColorApplication } from './hooks/useColorApplication'

// Component that applies colors to DOM
function ColorApplicationWrapper({ children }: { children: React.ReactNode }) {
  useColorApplication()
  return <>{children}</>
}

// Sets [DEV] prefix on browser tab title in dev mode
function DevTitleEffect() {
  useEffect(() => {
    if (import.meta.env.MODE === 'dev') {
      document.title = '[DEV] Plumo'
    }
  }, [])
  return null
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ColorApplicationWrapper>
          <DevTitleEffect />
          <Router
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
            <Routes>
              {/* Rota pública de login */}
              <Route path="/login" element={<LoginPage />} />

              {/* Rota de seleção de conta - requer autenticação mas não requer conta selecionada */}
              <Route path="/select-account" element={<SelectAccountPage />} />

              {/* Rotas protegidas - apenas para usuários autenticados (admin) */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <HomePage />
                  </ProtectedRoute>
                }
              />
              {/* Rotas de Configurações */}
              <Route
                path="/configuracoes/cartoes"
                element={
                  <ProtectedRoute>
                    <CartoesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes/contas"
                element={
                  <ProtectedRoute>
                    <ContasPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes/compartilhamentos"
                element={
                  <ProtectedRoute>
                    <CompartilhamentosPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes/tags-subtags"
                element={
                  <ProtectedRoute>
                    <TagsSubtagsPage />
                  </ProtectedRoute>
                }
              />

              {/* Redirects para as novas rotas de configurações */}
              <Route path="/cartoes" element={<Navigate to="/configuracoes/cartoes" replace />} />
              <Route path="/contas" element={<Navigate to="/configuracoes/contas" replace />} />
              <Route path="/compartilhamentos" element={<Navigate to="/configuracoes/compartilhamentos" replace />} />
              <Route path="/tags-subtags" element={<Navigate to="/configuracoes/tags-subtags" replace />} />
              <Route path="/parceiros" element={<Navigate to="/configuracoes/compartilhamentos" replace />} />
              {/* Redirect antigo /expenses para /mappings */}
              <Route
                path="/expenses"
                element={<Navigate to="/mappings" replace />}
              />
              {/* Redirect antigo /mappings/transactions para /mappings */}
              <Route
                path="/mappings/transactions"
                element={<Navigate to="/mappings" replace />}
              />
              <Route
                path="/mappings"
                element={
                  <ProtectedRoute>
                    <MappingsPage />
                  </ProtectedRoute>
                }
              />
              {/* Redirect /relatorios para /relatorios/graficos */}
              <Route
                path="/relatorios"
                element={<Navigate to="/relatorios/extrato" replace />}
              />
              <Route
                path="/relatorios/extrato"
                element={
                  <ProtectedRoute>
                    <ExtratoPage />
                  </ProtectedRoute>
                }
              />
              {/* Redirect antigo /relatorios/detalhamento para /relatorios/extrato */}
              <Route
                path="/relatorios/detalhamento"
                element={<Navigate to="/relatorios/extrato" replace />}
              />
              <Route
                path="/balanco"
                element={
                  <ProtectedRoute>
                    <BalancoPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/relatorios/faturas"
                element={
                  <ProtectedRoute>
                    <FaturasPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/relatorios/grupo"
                element={
                  <ProtectedRoute>
                    <GrupoPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/curadoria"
                element={
                  <ProtectedRoute>
                    <CuradoriaPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/templates"
                element={
                  <ProtectedRoute>
                    <ExpenseTemplatesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/emprestimos"
                element={
                  <ProtectedRoute>
                    <EmprestimosPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings/colors"
                element={
                  <ProtectedRoute>
                    <ColorSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Router>
        </ColorApplicationWrapper>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

