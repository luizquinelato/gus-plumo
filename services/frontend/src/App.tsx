import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { SidebarProvider } from './contexts/SidebarContext'
import { BalanceVisibilityProvider } from './contexts/BalanceVisibilityContext'
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
import ReconciliacaoPage from './pages/ReconciliacaoPage'
import TagsSubtagsPage from './pages/TagsSubtagsPage'
import ExpenseTemplatesPage from './pages/ExpenseTemplatesPage'
import GrupoPage from './pages/GrupoPage'
import EmprestimosPage from './pages/EmprestimosPage'
import ProfilePage from './pages/ProfilePage'
import PayrollPage from './pages/PayrollPage'
import AccountClosuresPage from './pages/AccountClosuresPage'
import HealthCheckPage from './pages/HealthCheckPage'
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
        <SidebarProvider>
        <BalanceVisibilityProvider>
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
              <Route path="/fechamentos" element={<Navigate to="/fechamentos/conta" replace />} />
              <Route
                path="/fechamentos/conta"
                element={
                  <ProtectedRoute>
                    <AccountClosuresPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/fechamentos/conta/fechados"
                element={
                  <ProtectedRoute>
                    <AccountClosuresPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/fechamentos/compartilhado/*"
                element={
                  <ProtectedRoute>
                    <BalancoPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/balanco" element={<Navigate to="/fechamentos/compartilhado" replace />} />
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
                path="/informes"
                element={
                  <ProtectedRoute>
                    <PayrollPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/relatorios/holerites" element={<Navigate to="/informes" replace />} />
              <Route
                path="/fechamentos/saude"
                element={
                  <ProtectedRoute>
                    <HealthCheckPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/saude-financeira" element={<Navigate to="/fechamentos/saude" replace />} />
              <Route
                path="/fechamentos/faturas"
                element={
                  <ProtectedRoute>
                    <ReconciliacaoPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/reconciliacao" element={<Navigate to="/fechamentos/faturas" replace />} />
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
                path="/configuracoes/cores"
                element={
                  <ProtectedRoute>
                    <ColorSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes/copy-settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              {/* Redirects das rotas antigas */}
              <Route path="/settings/colors" element={<Navigate to="/configuracoes/cores" replace />} />
              <Route path="/settings" element={<Navigate to="/configuracoes/copy-settings" replace />} />
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
        </BalanceVisibilityProvider>
        </SidebarProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

