import Sidebar from '../components/Sidebar'
import { CadastroListPageShell } from '../components/CadastroListPageLayout'
import TransactionMappingsTab from './tabs/TransactionMappingsTab'

const MappingsPage = () => {
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <TransactionMappingsTab />
      </CadastroListPageShell>
    </div>
  )
}

export default MappingsPage
