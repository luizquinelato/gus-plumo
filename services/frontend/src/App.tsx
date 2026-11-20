import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { SidebarProvider } from './contexts/SidebarContext'
import { DeviceModeProvider } from './contexts/DeviceModeContext'
import { MobileTopBarActionsProvider } from './contexts/MobileTopBarActionsContext'
import { BalanceVisibilityProvider } from './contexts/BalanceVisibilityContext'
import ProtectedRoute from './components/ProtectedRoute'
import ProtectedPageRoute from './components/ProtectedPageRoute'
import AdminRoute from './components/AdminRoute'
import LoginPage from './pages/LoginPage'
import SelectAccountPage from './pages/SelectAccountPage'
import HomePage from './pages/HomePage'
import ImportWizardPage from './pages/ImportWizardPage'
import CartoesPage from './pages/CartoesPage'
import ContasPage from './pages/ContasPage'
import CompartilhamentosPage from './pages/CompartilhamentosPage'
import ColorSettingsPage from './pages/ColorSettingsPage'
import SettingsPage from './pages/SettingsPage'
import TenantUsersSettingsPage from './pages/TenantUsersSettingsPage'
import TenantAccessSettingsPage from './pages/TenantAccessSettingsPage'
import MappingsPage from './pages/MappingsPage'
import ExtratoPage from './pages/ExtratoPage'
import BalancoPage from './pages/BalancoPage'
import FaturasPage from './pages/FaturasPage'
import SaldoParceladoPage from './pages/SaldoParceladoPage'
import ProjecaoMensalPage from './pages/ProjecaoMensalPage'
import CuradoriaPage from './pages/CuradoriaPage'
import ReconciliacaoPage from './pages/ReconciliacaoPage'
import TagsSubtagsPage from './pages/TagsSubtagsPage'
import ExpenseTemplatesPage from './pages/ExpenseTemplatesPage'
import GrupoPage from './pages/GrupoPage'
import EmprestimosPage from './pages/EmprestimosPage'
import ProfilePage from './pages/ProfilePage'
import PayrollPage from './pages/PayrollPage'
import ConsorciosPage from './pages/ConsorciosPage'
import AccountClosuresPage from './pages/AccountClosuresPage'
import HealthCheckPage from './pages/HealthCheckPage'
import { useColorApplication } from './hooks/useColorApplication'
import { useAlert } from './hooks/useAlert'

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

// Exibe, no diálogo padrão (useAlert), erros disparados por código fora de componentes React
function GlobalErrorAlert() {
  const { showError, AlertComponent } = useAlert()
  useEffect(() => {
    const handler = (event: Event) => {
      const { title, message } = (event as CustomEvent<{ title: string; message: string }>).detail
      showError(title, message)
    }
    window.addEventListener('app:error-alert', handler)
    return () => window.removeEventListener('app:error-alert', handler)
  })
  return <AlertComponent />
}

function App() {
  return (
    <ThemeProvider>
      <DeviceModeProvider>
      <AuthProvider>
        <MobileTopBarActionsProvider>
        <SidebarProvider>
        <BalanceVisibilityProvider>
        <ColorApplicationWrapper>
          <DevTitleEffect />
          <GlobalErrorAlert />
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
                  <ProtectedPageRoute pageKey="home">
                    <HomePage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/importar"
                element={
                  <ProtectedPageRoute pageKey="importar">
                    <ImportWizardPage />
                  </ProtectedPageRoute>
                }
              />
              {/* Rotas de Configurações */}
              <Route
                path="/configuracoes/cartoes"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.cartoes">
                    <CartoesPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/contas"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.contas">
                    <ContasPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/compartilhamentos"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.compartilhamentos">
                    <CompartilhamentosPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/tags-subtags"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.tags">
                    <TagsSubtagsPage />
                  </ProtectedPageRoute>
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
                  <ProtectedPageRoute pageKey="cadastro.mappings">
                    <MappingsPage />
                  </ProtectedPageRoute>
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
                  <ProtectedPageRoute pageKey="relatorios.extrato">
                    <ExtratoPage />
                  </ProtectedPageRoute>
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
                  <ProtectedPageRoute pageKey="fechamentos.conta">
                    <AccountClosuresPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/fechamentos/conta/fechados"
                element={
                  <ProtectedPageRoute pageKey="fechamentos.conta">
                    <AccountClosuresPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/fechamentos/compartilhado/*"
                element={
                  <ProtectedPageRoute pageKey="fechamentos.compartilhado">
                    <BalancoPage />
                  </ProtectedPageRoute>
                }
              />
              <Route path="/balanco" element={<Navigate to="/fechamentos/compartilhado" replace />} />
              <Route
                path="/relatorios/faturas"
                element={
                  <ProtectedPageRoute pageKey="relatorios.faturas">
                    <FaturasPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/relatorios/saldo-parcelado"
                element={
                  <ProtectedPageRoute pageKey="relatorios.saldo_parcelado">
                    <SaldoParceladoPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/relatorios/projecao-mensal"
                element={
                  <ProtectedPageRoute pageKey="relatorios.projecao">
                    <ProjecaoMensalPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/relatorios/grupo"
                element={
                  <ProtectedPageRoute pageKey="relatorios.grupo">
                    <GrupoPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/informes"
                element={
                  <ProtectedPageRoute pageKey="informes">
                    <PayrollPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/consorcios"
                element={
                  <ProtectedPageRoute pageKey="consorcios">
                    <ConsorciosPage />
                  </ProtectedPageRoute>
                }
              />
              <Route path="/relatorios/holerites" element={<Navigate to="/informes" replace />} />
              <Route
                path="/relatorios/saude"
                element={
                  <ProtectedPageRoute pageKey="relatorios.saude">
                    <HealthCheckPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/fechamentos/saude"
                element={
                  <ProtectedPageRoute pageKey="relatorios.saude">
                    <HealthCheckPage />
                  </ProtectedPageRoute>
                }
              />
              <Route path="/saude-financeira" element={<Navigate to="/relatorios/saude" replace />} />
              <Route
                path="/fechamentos/faturas"
                element={
                  <ProtectedPageRoute pageKey="fechamentos.faturas">
                    <ReconciliacaoPage />
                  </ProtectedPageRoute>
                }
              />
              <Route path="/reconciliacao" element={<Navigate to="/fechamentos/faturas" replace />} />
              <Route
                path="/curadoria"
                element={
                  <ProtectedPageRoute pageKey="curadoria">
                    <CuradoriaPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/templates"
                element={
                  <ProtectedPageRoute pageKey="cadastro.templates">
                    <ExpenseTemplatesPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/emprestimos"
                element={
                  <ProtectedPageRoute pageKey="emprestimos">
                    <EmprestimosPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/cores"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.cores">
                    <ColorSettingsPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/copy-settings"
                element={
                  <ProtectedPageRoute pageKey="configuracoes.copy">
                    <SettingsPage />
                  </ProtectedPageRoute>
                }
              />
              <Route
                path="/configuracoes/acessos"
                element={
                  <AdminRoute>
                    <ProtectedPageRoute pageKey="configuracoes.acessos">
                      <TenantAccessSettingsPage />
                    </ProtectedPageRoute>
                  </AdminRoute>
                }
              />
              <Route
                path="/configuracoes/usuarios"
                element={
                  <AdminRoute>
                    <ProtectedPageRoute pageKey="configuracoes.usuarios">
                      <TenantUsersSettingsPage />
                    </ProtectedPageRoute>
                  </AdminRoute>
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
        </MobileTopBarActionsProvider>
      </AuthProvider>
      </DeviceModeProvider>
    </ThemeProvider>
  )
}

export default App

