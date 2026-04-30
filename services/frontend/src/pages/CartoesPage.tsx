import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { Plus, Edit2, Trash2, CreditCard, RotateCcw, X, Archive } from 'lucide-react'
import { formatSharedAccountDisplay } from '../utils/accountFormatter'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'

interface Bank {
  id: number
  code: string
  name: string
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description?: string
  active: boolean
  shared_account?: {
    id: number
    name?: string
    description?: string
    bank?: Bank
    agency?: number
    account_number?: string
  }
}

interface Cartao {
  id: number
  name: string
  description?: string
  number: string
  type: string
  account_id?: number
  account_name?: string
  ownership_type: string
  expense_sharing_id?: number
  expense_sharing?: ExpenseSharing
  active: boolean
  closing_day?: number
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const CartoesPage = () => {
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [compartilhamentos, setCompartilhamentos] = useState<ExpenseSharing[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCartao, setEditingCartao] = useState<Cartao | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    number: '',
    type: 'credito',
    ownership_type: 'proprio',
    expense_sharing_id: '',
    closing_day: '14'
  })
  const [originalOwnershipType, setOriginalOwnershipType] = useState<string>('proprio')
  const [originalExpenseSharingId, setOriginalExpenseSharingId] = useState<number | null>(null)
  const [updateExistingRecords, setUpdateExistingRecords] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    carregarCompartilhamentos()
    carregarCartoes()
  }, [])

  // Atalhos de teclado para o modal
  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharModal()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          const form = document.querySelector('form')
          if (form) {
            form.requestSubmit()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showModal])

  const carregarCompartilhamentos = async () => {
    try {
      const response = await axios.get('/api/expense-sharing/')
      setCompartilhamentos(response.data.filter((c: ExpenseSharing) => c.active))
    } catch (error) {
      console.error('Erro ao carregar compartilhamentos:', error)
    }
  }

  const carregarCartoes = async () => {
    try {
      const response = await axios.get('/api/cartoes/?incluir_inativos=true')
      setCartoes(response.data)
    } catch (error) {
      console.error('Erro ao carregar cartões:', error)
      showToast('Erro ao carregar cartões', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Preparar payload com conversões de tipo
      const payload: any = {
        name: formData.name,
        description: formData.description || null,
        number: formData.number,
        type: formData.type,
        ownership_type: formData.ownership_type,
        closing_day: parseInt(formData.closing_day) || 14
      }

      // Adicionar expense_sharing_id se ownership_type for 'compartilhado', senão null
      if (formData.ownership_type === 'compartilhado' && formData.expense_sharing_id) {
        payload.expense_sharing_id = parseInt(formData.expense_sharing_id)
      } else {
        payload.expense_sharing_id = null
      }

      if (editingCartao) {
        // Adiciona flag de atualização se checkbox está marcado
        if (updateExistingRecords) {
          payload.update_existing_records = true
        }

        await axios.put(`/api/cartoes/${editingCartao.id}`, payload)
      } else {
        await axios.post('/api/cartoes/', payload)
      }

      await carregarCartoes()
      fecharModal()
      showToast(editingCartao ? 'Cartão atualizado com sucesso!' : 'Cartão criado com sucesso!', 'success')
    } catch (error: any) {
      console.error('Erro ao salvar cartão:', error)
      showToast(error.response?.data?.detail || error.message || 'Erro ao salvar cartão', 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Cartão',
      'Tem certeza que deseja inativar este cartão?\n\nEle será movido para a seção de cartões inativos.',
      async () => {
        try {
          await axios.put(`/api/cartoes/${id}`, { active: false })
          await carregarCartoes()
          showToast('Cartão inativado com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao inativar cartão:', error)
          showToast('Erro ao inativar cartão', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleDelete = (id: number) => {
    showConfirm(
      'Deletar Permanentemente',
      '⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nTem certeza que deseja DELETAR PERMANENTEMENTE este cartão?\n\nTodos os dados relacionados serão perdidos.',
      async () => {
        try {
          await axios.delete(`/api/cartoes/${id}`)
          await carregarCartoes()
          showToast('Cartão deletado permanentemente!', 'success')
        } catch (error) {
          console.error('Erro ao deletar cartão:', error)
          showToast('Erro ao deletar cartão', 'error')
        }
      },
      'Deletar Permanentemente',
      'Cancelar'
    )
  }

  const abrirModalNovo = () => {
    setEditingCartao(null)
    setFormData({
      name: '',
      description: '',
      number: '',
      type: 'credito',
      ownership_type: 'proprio',
      expense_sharing_id: ''
    })
    setShowModal(true)
  }

  const abrirModalEditar = (cartao: Cartao) => {
    setEditingCartao(cartao)
    setOriginalOwnershipType(cartao.ownership_type || 'proprio')
    setOriginalExpenseSharingId(cartao.expense_sharing_id || null)
    setUpdateExistingRecords(false)
    setFormData({
      name: cartao.name,
      description: cartao.description || '',
      number: cartao.number,
      type: cartao.type || 'credito',
      ownership_type: cartao.ownership_type || 'proprio',
      expense_sharing_id: cartao.expense_sharing_id?.toString() || '',
      closing_day: cartao.closing_day?.toString() || '14'
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingCartao(null)
    setOriginalOwnershipType('proprio')
    setOriginalExpenseSharingId(null)
    setUpdateExistingRecords(false)
    setFormData({
      name: '',
      description: '',
      number: '',
      type: 'credito',
      ownership_type: 'proprio',
      expense_sharing_id: '',
      closing_day: '14'
    })
  }

  const getOwnershipTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'proprio': 'Próprio',
      'compartilhado': 'Compartilhado'
    }
    return labels[type] || type
  }

  // Separar cartões ativos e inativos
  const cartoesAtivos = cartoes.filter(c => c.active)
  const cartoesInativos = cartoes.filter(c => !c.active)

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Cartão',
      'Tem certeza que deseja reativar este cartão?\n\nEle será movido de volta para a seção de cartões ativos.',
      async () => {
        try {
          await axios.post(`/api/cartoes/${id}/reativar`)
          await carregarCartoes()
          showToast('Cartão reativado com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao reativar cartão:', error)
          showToast('Erro ao reativar cartão', 'error')
        }
      },
      'Reativar',
      'Cancelar'
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <CreditCard className="w-8 h-8" />
                Gerenciar Cartões
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Cadastre e gerencie seus cartões de crédito
              </p>
            </div>
            <button
              onClick={abrirModalNovo}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-white hover:opacity-90"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              <Plus size={20} />
              Novo Cartão
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner message="Carregando..." />
            </div>
          ) : cartoes.length === 0 ? (
            <div
              className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700"
              style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
            >
              <CreditCard size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Nenhum cartão cadastrado
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Comece adicionando seu primeiro cartão de crédito
              </p>
              <button
                onClick={abrirModalNovo}
                className="px-4 py-2 rounded-lg text-white hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                Adicionar Cartão
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '4%' }}>
                      #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '20%' }}>
                      Nome
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '11%' }}>
                      Últimos 4 Dígitos
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '12%' }}>
                      Propriedade
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '11%' }}>
                      Tipo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '10%' }}>
                      Dia Fechamento
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '17%' }}>
                      Compartilhamento
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" style={{ width: '15%' }}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {/* Cartões Ativos */}
                  {cartoesAtivos.length > 0 && (
                    <>
                      {cartoesAtivos.map((cartao, index) => {
                        // Define cor baseada no tipo de propriedade (apenas próprio ou compartilhado)
                        const ownershipColor = cartao.ownership_type === 'proprio' ? '1' : '4'

                        // Define cor do badge baseada no tipo
                        const badgeColor = cartao.type === 'credito' ? '2' : '3'

                        return (
                          <tr
                            key={cartao.id}
                            className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                            onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {index + 1}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div
                                  className="p-1.5 rounded-md shadow-sm flex-shrink-0"
                                  style={{ background: 'var(--gradient-1-2)' }}
                                >
                                  <CreditCard size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                </div>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                  {cartao.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">
                              •••• {cartao.number}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className="inline-block px-3 py-1 text-xs font-medium rounded w-[110px] text-center"
                                style={{
                                  backgroundColor: `var(--color-${ownershipColor})`,
                                  color: `var(--on-color-${ownershipColor})`
                                }}
                              >
                                {getOwnershipTypeLabel(cartao.ownership_type)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className="inline-block px-3 py-1 text-xs font-medium rounded w-[110px] text-center"
                                style={{
                                  backgroundColor: `var(--color-${badgeColor})`,
                                  color: `var(--on-color-${badgeColor})`
                                }}
                              >
                                {cartao.type === 'credito' ? 'Crédito' : 'Benefícios'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                              {cartao.closing_day || 14}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {cartao.ownership_type === 'compartilhado' && cartao.expense_sharing?.shared_account ? (
                                <SharedAccountDisplay
                                  account={cartao.expense_sharing.shared_account}
                                  ownershipPercentage={cartao.expense_sharing.my_contribution_percentage}
                                />
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500 italic">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => abrirModalEditar(cartao)}
                                  className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                  title="Editar"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  onClick={() => handleInativar(cartao.id)}
                                  className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300"
                                  title="Inativar"
                                >
                                  <Archive size={16} />
                                </button>
                                <button
                                  onClick={() => handleDelete(cartao.id)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                                  title="Deletar Permanentemente"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  )}

                  {/* Separador para Cartões Inativos */}
                  {cartoesInativos.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={8} className="px-0 py-0">
                          <div className="relative py-4 bg-gray-50 dark:bg-gray-900">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t-2 border-gray-300 dark:border-gray-600"></div>
                            </div>
                            <div className="relative flex justify-center">
                              <span className="px-4 bg-gray-50 dark:bg-gray-900 text-sm font-medium text-gray-500 dark:text-gray-400">
                                Cartões Inativos
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {cartoesInativos.map((cartao, index) => {
                        // Define cor baseada no tipo de propriedade (apenas próprio ou compartilhado)
                        const ownershipColor = cartao.ownership_type === 'proprio' ? '1' : '4'

                        // Define cor do badge baseada no tipo
                        const badgeColor = cartao.type === 'credito' ? '2' : '3'

                        return (
                          <tr
                            key={cartao.id}
                            className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all opacity-60"
                            onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                          >
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                {index + 1}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="p-1.5 rounded-md shadow-sm flex-shrink-0"
                                    style={{ background: 'var(--gradient-1-2)' }}
                                  >
                                    <CreditCard size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {cartao.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">
                                •••• {cartao.number}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className="inline-block px-3 py-1 text-xs font-medium rounded w-[110px] text-center"
                                  style={{
                                    backgroundColor: `var(--color-${ownershipColor})`,
                                    color: `var(--on-color-${ownershipColor})`
                                  }}
                                >
                                  {getOwnershipTypeLabel(cartao.ownership_type)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className="inline-block px-3 py-1 text-xs font-medium rounded w-[110px] text-center"
                                  style={{
                                    backgroundColor: `var(--color-${badgeColor})`,
                                    color: `var(--on-color-${badgeColor})`
                                  }}
                                >
                                  {cartao.type === 'credito' ? 'Crédito' : 'Benefícios'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                                {cartao.closing_day || 14}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                {cartao.ownership_type === 'compartilhado' && cartao.expense_sharing?.shared_account ? (
                                  <SharedAccountDisplay
                                    account={cartao.expense_sharing.shared_account}
                                    ownershipPercentage={cartao.expense_sharing.my_contribution_percentage}
                                  />
                                ) : (
                                  <span className="text-gray-400 dark:text-gray-500 italic">-</span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => abrirModalEditar(cartao)}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                    title="Editar"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleReativar(cartao.id)}
                                    className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300"
                                    title="Reativar"
                                  >
                                    <RotateCcw size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(cartao.id)}
                                    className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                                    title="Deletar Permanentemente"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full mx-4 border border-gray-200 dark:border-gray-700"
            style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)' }}
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {editingCartao ? 'Editar Cartão' : 'Novo Cartão'}
              </h2>
              <button
                type="button"
                onClick={fecharModal}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Fechar (ESC)"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                {/* Nome - Linha completa */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Ex: Gustavo"
                  />
                </div>

                {/* Tipo e Últimos 4 dígitos - Lado a lado */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tipo *
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      required
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="credito">Crédito</option>
                      <option value="beneficios">Benefícios</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Últimos 4 dígitos *
                    </label>
                    <input
                      type="text"
                      value={formData.number}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 4)
                        setFormData({ ...formData, number: value })
                      }}
                      required
                      maxLength={4}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: 1234"
                    />
                  </div>
                </div>

                {/* Dia de Fechamento e Tipo de Propriedade - Lado a lado */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Dia de Fechamento *
                    </label>
                    <input
                      type="number"
                      value={formData.closing_day}
                      onChange={(e) => setFormData({ ...formData, closing_day: e.target.value })}
                      required
                      min={1}
                      max={30}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: 14"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tipo de Propriedade *
                    </label>
                    <select
                      value={formData.ownership_type}
                      onChange={(e) => setFormData({
                        ...formData,
                        ownership_type: e.target.value
                      })}
                      required
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="proprio">Próprio</option>
                      <option value="compartilhado">Compartilhado</option>
                    </select>
                  </div>
                </div>

                {/* Descrição - Linha completa */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Descrição (opcional)
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Ex: Cartão principal"
                  />
                </div>

                {/* Compartilhamento - Condicional */}
                {formData.ownership_type === 'compartilhado' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Compartilhamento *
                    </label>
                    <select
                      value={formData.expense_sharing_id}
                      onChange={(e) => setFormData({ ...formData, expense_sharing_id: e.target.value })}
                      required
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Selecione um compartilhamento...</option>
                      {compartilhamentos.map(comp => (
                        <option key={comp.id} value={comp.id}>
                          {formatSharedAccountDisplay(comp.shared_account, comp.my_contribution_percentage)}
                        </option>
                      ))}
                    </select>
                    {compartilhamentos.length === 0 && (
                      <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-400">
                        Nenhum compartilhamento cadastrado para esta conta. <a href="/compartilhamentos" className="underline">Criar compartilhamento</a>
                      </p>
                    )}
                  </div>
                )}

                {/* Checkbox para atualizar registros existentes - sempre visível ao editar */}
                {editingCartao && (() => {
                  // Calcula se houve mudança no compartilhamento
                  const currentExpenseSharingId = formData.ownership_type === 'compartilhado' && formData.expense_sharing_id
                    ? parseInt(formData.expense_sharing_id)
                    : null

                  const ownershipTypeChanged = originalOwnershipType !== formData.ownership_type
                  const sharingIdChanged = originalExpenseSharingId !== currentExpenseSharingId
                  const hasSharingChange = ownershipTypeChanged || sharingIdChanged

                  return (
                    <div className={`border rounded-md p-3 ${
                      hasSharingChange
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700'
                        : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700'
                    }`}>
                      <label className={`flex items-start gap-2 ${hasSharingChange ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={updateExistingRecords}
                          onChange={(e) => setUpdateExistingRecords(e.target.checked)}
                          disabled={!hasSharingChange}
                          className="mt-1 h-4 w-4 text-color-primary focus:ring-color-primary border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            Atualizar registros existentes
                          </span>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {!hasSharingChange ? (
                              'Esta opção só fica disponível quando você altera o tipo de propriedade ou o compartilhamento do cartão.'
                            ) : formData.ownership_type === 'compartilhado' ? (
                              'Ao marcar esta opção, todos os registros existentes nas tabelas de extrato bancário, faturas de cartão e benefícios serão atualizados com o novo compartilhamento.'
                            ) : (
                              'Ao marcar esta opção, todos os registros existentes nas tabelas de extrato bancário, faturas de cartão e benefícios terão o compartilhamento removido (100% próprio).'
                            )}
                          </p>
                        </div>
                      </label>
                    </div>
                  )
                })()}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={fecharModal}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 text-white rounded-md hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  {editingCartao ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </main>

      {/* Toast de notificações */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      {/* Dialog de confirmação */}
      <ConfirmComponent />
    </div>
  )
}

export default CartoesPage

