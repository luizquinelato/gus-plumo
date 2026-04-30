import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { Plus, Edit2, Trash2, X, Archive, RotateCcw, Users, Lock } from 'lucide-react'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'
import { formatAccountDisplay } from '../utils/accountFormatter'

interface Bank {
  id: number
  code: string
  name: string
  full_name?: string
}

interface Account {
  id: number
  name?: string
  description?: string
  bank?: Bank
  agency?: string
  account_number?: string
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description?: string
  active: boolean
  shared_account?: Account
  is_inverse?: boolean  // True quando visualizado pela contraparte (somente leitura)
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const CompartilhamentosPage = () => {
  const [compartilhamentos, setCompartilhamentos] = useState<ExpenseSharing[]>([])
  const [minhasOutrasContas, setMinhasOutrasContas] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCompartilhamento, setEditingCompartilhamento] = useState<ExpenseSharing | null>(null)
  const [formData, setFormData] = useState({
    shared_account_id: '',
    my_contribution_percentage: '50.00',
    description: ''
  })
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Formata agência com máscara xxxxx-x (5 dígitos + 1 verificador)
  const formatAgency = (agency?: string | number) => {
    if (!agency) return '-'
    const agencyStr = agency.toString().padStart(6, '0')  // Padding para 6 dígitos (5+1)
    const lastDigit = agencyStr.slice(-1)
    const firstPart = agencyStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Formata número da conta com máscara xxxxxxxxx-x (9 dígitos + 1 verificador)
  const formatAccount = (accountNumber?: string | number) => {
    if (!accountNumber) return '-'
    const accountStr = accountNumber.toString().padStart(10, '0')  // Padding para 10 dígitos (9+1)
    const lastDigit = accountStr.slice(-1)
    const firstPart = accountStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  useEffect(() => {
    carregarCompartilhamentos()
    carregarMinhasOutrasContas()
  }, [])

  // Atalhos de teclado para o modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        fecharModal()
      } else if (e.key === 'Enter' && showModal && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    }

    if (showModal) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showModal, formData])

  const carregarCompartilhamentos = async () => {
    try {
      setLoading(true)
      // Buscar TODOS os compartilhamentos (incluindo inativos)
      const response = await axios.get('/api/expense-sharing/?incluir_inativos=true')
      setCompartilhamentos(response.data)
    } catch (error) {
      console.error('Erro ao carregar compartilhamentos:', error)
      showToast('Erro ao carregar compartilhamentos', 'error')
    } finally {
      setLoading(false)
    }
  }

  const carregarMinhasOutrasContas = async () => {
    try {
      const response = await axios.get('/api/expense-sharing/my-other-accounts')
      setMinhasOutrasContas(response.data)
    } catch (error) {
      console.error('Erro ao carregar outras contas:', error)
      showToast('Erro ao carregar contas disponíveis', 'error')
    }
  }

  const abrirModalNovo = async () => {
    setEditingCompartilhamento(null)
    setFormData({
      shared_account_id: '',
      my_contribution_percentage: '50.00',
      description: ''
    })
    // Recarregar contas disponíveis antes de abrir o modal
    await carregarMinhasOutrasContas()
    setShowModal(true)
  }

  const abrirModalEditar = (compartilhamento: ExpenseSharing) => {
    setEditingCompartilhamento(compartilhamento)
    setFormData({
      shared_account_id: compartilhamento.shared_account_id.toString(),
      my_contribution_percentage: compartilhamento.my_contribution_percentage.toString(),
      description: compartilhamento.description || ''
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingCompartilhamento(null)
    setFormData({
      shared_account_id: '',
      my_contribution_percentage: '50.00',
      description: ''
    })
  }

  const handleSubmit = async () => {
    try {
      const payload: any = {
        my_contribution_percentage: parseFloat(formData.my_contribution_percentage),
        description: formData.description || null
      }

      if (editingCompartilhamento) {
        // Atualizar
        await axios.put(
          `/api/expense-sharing/${editingCompartilhamento.id}`,
          payload
        )
        showToast('Compartilhamento atualizado com sucesso!', 'success')
      } else {
        // Criar
        payload.shared_account_id = parseInt(formData.shared_account_id)
        await axios.post('/api/expense-sharing/', payload)
        showToast('Compartilhamento criado com sucesso!', 'success')
      }

      fecharModal()
      await carregarCompartilhamentos()
    } catch (error: any) {
      console.error('Erro ao salvar compartilhamento:', error)
      const errorMessage = error.response?.data?.detail || 'Erro ao salvar compartilhamento'
      showToast(errorMessage, 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Compartilhamento',
      'Tem certeza que deseja inativar este compartilhamento?',
      async () => {
        try {
          await axios.put(`/api/expense-sharing/${id}/inactivate`)
          showToast('Compartilhamento inativado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao inativar compartilhamento:', error)
          showToast('Erro ao inativar compartilhamento', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Compartilhamento',
      'Tem certeza que deseja reativar este compartilhamento?',
      async () => {
        try {
          await axios.put(`/api/expense-sharing/${id}/reactivate`)
          showToast('Compartilhamento reativado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao reativar compartilhamento:', error)
          showToast('Erro ao reativar compartilhamento', 'error')
        }
      },
      'Reativar',
      'Cancelar'
    )
  }

  const handleDeletar = (id: number) => {
    showConfirm(
      'Deletar Compartilhamento',
      'Tem certeza que deseja deletar permanentemente este compartilhamento? Esta ação não pode ser desfeita.',
      async () => {
        try {
          await axios.delete(`/api/expense-sharing/${id}`)
          showToast('Compartilhamento deletado com sucesso!', 'success')
          await carregarCompartilhamentos()
        } catch (error) {
          console.error('Erro ao deletar compartilhamento:', error)
          showToast('Erro ao deletar compartilhamento', 'error')
        }
      },
      'Deletar',
      'Cancelar'
    )
  }



  const compartilhamentosAtivos = compartilhamentos.filter(c => c.active)
  const compartilhamentosInativos = compartilhamentos.filter(c => !c.active)

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <Users className="w-8 h-8" />
                Configurações de Compartilhamento
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Configure como dividir despesas com outras contas
              </p>
            </div>
            <button
              onClick={abrirModalNovo}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-white hover:opacity-90"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              <Plus size={20} />
              Novo Compartilhamento
            </button>
          </div>
          {loading ? (
            <div className="text-center py-12">
              <LoadingSpinner message="Carregando..." />
            </div>
          ) : compartilhamentos.length === 0 ? (
            <div
              className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700"
              style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
            >
              <Users size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Nenhum compartilhamento cadastrado
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Comece adicionando seu primeiro compartilhamento de despesas
              </p>
              <button
                onClick={abrirModalNovo}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                Adicionar Compartilhamento
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Compartilhamentos Ativos */}
              {compartilhamentosAtivos.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '4%' }}>
                          #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>
                          Nome da Conta
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>
                          Banco
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                          Agência
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                          Conta
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '20%' }}>
                          Descrição
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '12%' }}>
                          Minha Contribuição
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                          A Contraparte Paga
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '8%' }}>
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800">
                      {compartilhamentosAtivos.map((comp, index) => {
                        // Define cores dos badges baseadas na porcentagem
                        const minhaContribuicao = comp.my_contribution_percentage
                        const outraContaPaga = 100 - minhaContribuicao

                        // Escala de cores em 5 faixas:
                        // >80: color-1 (vermelho - paga muito)
                        // 60<x<=80: color-2 (verde)
                        // 40<x<=60: color-3 (amarelo)
                        // 20<x<=40: color-4 (laranja)
                        // 0<=x<=20: color-5 (roxo - paga pouco)
                        const getColorByPercentage = (percentage: number) => {
                          if (percentage > 80) return '1' // Vermelho
                          if (percentage > 60) return '2' // Verde
                          if (percentage > 40) return '3' // Amarelo
                          if (percentage > 20) return '4' // Laranja
                          return '5' // Roxo
                        }

                        return (
                          <tr
                            key={comp.id}
                            className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                            onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500 dark:text-gray-400">
                              {index + 1}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div
                                  className="p-1.5 rounded-md shadow-sm flex-shrink-0"
                                  style={{ background: 'var(--gradient-1-2)' }}
                                >
                                  <Users size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                </div>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                  {comp.shared_account?.name || '-'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                              {comp.shared_account?.bank?.code || '---'} - {comp.shared_account?.bank?.name || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-white">
                              {comp.shared_account?.agency ? formatAgency(comp.shared_account.agency) : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-white">
                              {comp.shared_account?.account_number ? formatAccount(comp.shared_account.account_number) : '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate">
                              {comp.description || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span
                                className="inline-block px-3 py-1 text-xs font-medium rounded w-[90px] text-center"
                                style={{
                                  backgroundColor: `var(--color-${getColorByPercentage(minhaContribuicao)})`,
                                  color: `var(--on-color-${getColorByPercentage(minhaContribuicao)})`
                                }}
                              >
                                {minhaContribuicao}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span
                                className="inline-block px-3 py-1 text-xs font-medium rounded w-[90px] text-center"
                                style={{
                                  backgroundColor: `var(--color-${getColorByPercentage(outraContaPaga)})`,
                                  color: `var(--on-color-${getColorByPercentage(outraContaPaga)})`
                                }}
                              >
                                {outraContaPaga}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                              {comp.is_inverse ? (
                                <div
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 cursor-help"
                                  title="Este compartilhamento foi configurado pela conta parceira. Apenas a conta que criou pode editá-lo."
                                >
                                  <Lock size={12} className="text-gray-500 dark:text-gray-400" />
                                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Contraparte</span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => abrirModalEditar(comp)}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                    title="Editar"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleInativar(comp.id)}
                                    className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300"
                                    title="Inativar"
                                  >
                                    <Archive size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeletar(comp.id)}
                                    className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                                    title="Deletar Permanentemente"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Divisor para Compartilhamentos Inativos */}
              {compartilhamentosInativos.length > 0 && (
                <>
                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t-2 border-gray-300 dark:border-gray-600"></div>
                    </div>
                    <div className="relative flex justify-center">
                      <span className="px-4 bg-gray-100 dark:bg-gray-900 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Compartilhamentos Inativos
                      </span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden opacity-60">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'fixed' }}>
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '4%' }}>
                            #
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>
                            Nome da Conta
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>
                            Banco
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                            Agência
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                            Conta
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '18%' }}>
                            Descrição
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                            Minha Contribuição
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>
                            A Contraparte Paga
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '8%' }}>
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800">
                        {compartilhamentosInativos.map((comp, index) => {
                          const minhaContribuicao = comp.my_contribution_percentage
                          const outraContaPaga = 100 - minhaContribuicao

                          return (
                            <tr
                              key={comp.id}
                              className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                              onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500 dark:text-gray-400">
                                {index + 1}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="p-1.5 rounded-md shadow-sm flex-shrink-0 opacity-50"
                                    style={{ background: 'var(--gradient-1-2)' }}
                                  >
                                    <Users size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {comp.shared_account?.name || '-'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                {comp.shared_account?.bank?.code || '---'} - {comp.shared_account?.bank?.name || '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-white">
                                {comp.shared_account?.agency ? formatAgency(comp.shared_account.agency) : '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-white">
                                {comp.shared_account?.account_number ? formatAccount(comp.shared_account.account_number) : '-'}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 truncate">
                                {comp.description || '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="inline-block px-3 py-1 text-xs font-medium rounded w-[90px] text-center bg-gray-400 text-white">
                                  {minhaContribuicao}%
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="inline-block px-3 py-1 text-xs font-medium rounded w-[90px] text-center bg-gray-400 text-white">
                                  {outraContaPaga}%
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                {comp.is_inverse ? (
                                  <div
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 cursor-help"
                                    title="Este compartilhamento foi configurado pela conta parceira. Apenas a conta que criou pode editá-lo."
                                  >
                                    <Lock size={12} className="text-gray-500 dark:text-gray-400" />
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Contraparte</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      onClick={() => abrirModalEditar(comp)}
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                      title="Editar"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                    <button
                                      onClick={() => handleReativar(comp.id)}
                                      className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300"
                                      title="Reativar"
                                    >
                                      <RotateCcw size={16} />
                                    </button>
                                    <button
                                      onClick={() => handleDeletar(comp.id)}
                                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                                      title="Deletar Permanentemente"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {editingCompartilhamento ? 'Editar Compartilhamento' : 'Novo Compartilhamento'}
              </h2>
              <button
                onClick={fecharModal}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Conta Compartilhada */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Compartilhar com *
                </label>
                {minhasOutrasContas.length === 0 ? (
                  <div className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    Carregando contas disponíveis...
                  </div>
                ) : (
                  <select
                    value={formData.shared_account_id}
                    onChange={(e) => setFormData({ ...formData, shared_account_id: e.target.value })}
                    disabled={!!editingCompartilhamento}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[var(--color-1)] focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  >
                    <option value="">Selecione uma conta...</option>
                    {minhasOutrasContas.map((conta) => (
                      <option key={conta.id} value={conta.id}>
                        {formatAccountDisplay(conta)}
                      </option>
                    ))}
                  </select>
                )}
                {editingCompartilhamento && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    A conta compartilhada não pode ser alterada após a criação
                  </p>
                )}
              </div>

              {/* Minha Contribuição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Minha Contribuição (%) *
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.my_contribution_percentage}
                  onChange={(e) => {
                    const value = e.target.value
                    // Permitir campo vazio ou valores entre 0 e 100
                    if (value === '' || (parseFloat(value) >= 0 && parseFloat(value) <= 100)) {
                      setFormData({ ...formData, my_contribution_percentage: value })
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[var(--color-1)] focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Minha parte: {formData.my_contribution_percentage}%
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    Outra conta: {100 - parseFloat(formData.my_contribution_percentage || '0')}%
                  </span>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Descrição
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[var(--color-1)] focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                  placeholder="Observações sobre este compartilhamento..."
                />
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={fecharModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!formData.shared_account_id || !formData.my_contribution_percentage}
                className="flex-1 px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                {editingCompartilhamento ? 'Atualizar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmComponent />
    </div>
  )
}

export default CompartilhamentosPage

