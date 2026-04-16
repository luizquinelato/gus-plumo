import Sidebar from '../components/Sidebar'
import TransactionMappingsTab from './tabs/TransactionMappingsTab'

const MappingsPage = () => {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          {/* Content */}
          <TransactionMappingsTab />
        </div>
      </main>
    </div>
  )
}

export default MappingsPage

