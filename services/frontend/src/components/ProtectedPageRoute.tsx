import ProtectedRoute from './ProtectedRoute'
import PageAccessRoute from './PageAccessRoute'
import { PageMutationProvider } from '../contexts/PageMutationContext'

export default function ProtectedPageRoute({
  pageKey,
  children,
}: {
  pageKey: string
  children: React.ReactNode
}) {
  return (
    <ProtectedRoute>
      <PageAccessRoute pageKey={pageKey}>
        <PageMutationProvider pageKey={pageKey}>{children}</PageMutationProvider>
      </PageAccessRoute>
    </ProtectedRoute>
  )
}