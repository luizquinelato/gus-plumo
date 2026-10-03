import { Navigate, Route, Routes } from 'react-router-dom'
import SharedBalanceListPage from './SharedBalanceListPage'
import SharedBalanceClosureWizardPage from './SharedBalanceClosureWizardPage'

export default function BalancoPage() {
  return (
    <Routes>
      <Route index element={<SharedBalanceListPage />} />
      <Route path="realizar" element={<SharedBalanceClosureWizardPage />} />
      <Route path="historico" element={<Navigate to="/fechamentos/compartilhado" replace />} />
      <Route path="lista" element={<Navigate to="/fechamentos/compartilhado" replace />} />
    </Routes>
  )
}
