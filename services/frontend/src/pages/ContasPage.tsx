import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import { Plus, Edit2, Trash2, Building2, RotateCcw, X, Archive, Landmark } from 'lucide-react'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'

interface Bank {
  id: number
  code: string
  name: string
  full_name?: string
  ispb?: string
  active: boolean
}

interface Conta {
  id: number
  user_id: number
  name?: string
  description?: string
  account_type?: string
  bank_id?: number
  bank?: Bank
  agency?: number
  account_number?: number
  active: boolean
  last_updated_at?: string
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const ContasPage = () => {
  const [contas, setContas] = useState<Conta[]>([])
  const [bancos, setBancos] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingConta, setEditingConta] = useState<Conta | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    account_type: '',
    bank_id: '',
    agency: '',
    account_number: ''
  })

  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    carregarContas()
    carregarBancos()
  }, [])

  // Atalhos de teclado para o modal
  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharModal()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Verifica se o foco não está em um textarea ou select
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          // Dispara o submit do formulário
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

  const carregarBancos = async () => {
    try {
      const response = await axios.get('/api/accounts/banks')
      setBancos(response.data)
    } catch (error) {
      console.error('Erro ao carregar bancos:', error)
      showToast('Erro ao carregar lista de bancos', 'error')
    }
  }

  const carregarContas = async () => {
    try {
      const response = await axios.get('/api/accounts/?incluir_inativos=true')
      setContas(response.data)
    } catch (error) {
      console.error('Erro ao carregar contas:', error)
      showToast('Erro ao carregar contas', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Valida que o número da conta não seja zero
    if (formData.account_number && parseInt(formData.account_number) === 0) {
      showToast('Número da conta inválido: não pode ser zero.', 'error')
      return
    }

    try {
      // Converte bank_id, agency e account_number para número
      const payload = {
        ...formData,
        bank_id: formData.bank_id ? parseInt(formData.bank_id) : null,
        agency: formData.agency ? parseInt(formData.agency) : null,
        account_number: formData.account_number ? parseInt(formData.account_number) : null
      }

      if (editingConta) {
        await axios.put(`/api/accounts/${editingConta.id}`, payload)
      } else {
        await axios.post('/api/accounts/', payload)
      }

      await carregarContas()
      fecharModal()
      showToast(editingConta ? 'Conta atualizada com sucesso!' : 'Conta criada com sucesso!', 'success')
    } catch (error: any) {
      console.error('Erro ao salvar conta:', error)
      showToast(error.response?.data?.detail || error.message || 'Erro ao salvar conta', 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Conta',
      'Tem certeza que deseja inativar esta conta?\n\nEla será movida para a seção de contas inativas.',
      async () => {
        try {
          await axios.put(`/api/accounts/${id}`, { active: false })
          await carregarContas()
          showToast('Conta inativada com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao inativar conta:', error)
          showToast('Erro ao inativar conta', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Conta',
      'Tem certeza que deseja reativar esta conta?\n\nEla será movida de volta para a seção de contas ativas.',
      async () => {
        try {
          await axios.put(`/api/accounts/${id}`, { active: true })
          await carregarContas()
          showToast('Conta reativada com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao reativar conta:', error)
          showToast('Erro ao reativar conta', 'error')
        }
      },
      'Reativar',
      'Cancelar'
    )
  }

  const handleDelete = (id: number) => {
    showConfirm(
      'Deletar Permanentemente',
      '⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nTem certeza que deseja DELETAR PERMANENTEMENTE esta conta?\n\nTodos os dados relacionados serão perdidos.',
      async () => {
        try {
          await axios.delete(`/api/accounts/${id}`)
          await carregarContas()
          showToast('Conta deletada permanentemente!', 'success')
        } catch (error) {
          console.error('Erro ao deletar conta:', error)
          showToast('Erro ao deletar conta', 'error')
        }
      },
      'Deletar Permanentemente',
      'Cancelar'
    )
  }

  const abrirModalNovo = () => {
    setEditingConta(null)
    setFormData({
      name: '',
      description: '',
      account_type: '',
      bank_id: '',
      agency: '',
      account_number: ''
    })
    setShowModal(true)
  }

  const abrirModalEditar = (conta: Conta) => {
    setEditingConta(conta)
    setFormData({
      name: conta.name || '',
      description: conta.description || '',
      account_type: conta.account_type || '',
      bank_id: conta.bank_id?.toString() || '',
      agency: conta.agency?.toString() || '',
      account_number: conta.account_number?.toString() || ''
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingConta(null)
    setFormData({
      name: '',
      description: '',
      account_type: '',
      bank_id: '',
      agency: '',
      account_number: ''
    })
  }

  const getAccountTypeLabel = (type?: string) => {
    if (!type) return '-'
    const types: { [key: string]: string } = {
      'corrente': 'Conta Corrente',
      'poupanca': 'Poupança',
      'investimento': 'Investimento'
    }
    return types[type] || type
  }

  // Formatar agência com máscara xxxxx-x (5 dígitos + 1 verificador)
  const formatAgency = (agency?: string | number) => {
    if (!agency) return '-'
    const agencyStr = agency.toString().padStart(6, '0')  // Padding para 6 dígitos (5+1)
    const lastDigit = agencyStr.slice(-1)
    const firstPart = agencyStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Máscara de agência para input (sem padding, só insere o traço antes do último dígito)
  const maskAgencyInput = (raw: string) => {
    if (raw.length <= 1) return raw
    return `${raw.slice(0, -1)}-${raw.slice(-1)}`
  }

  // Formatar número da conta com máscara xxxxxxxxx-x (9 dígitos + 1 verificador)
  const formatAccount = (accountNumber?: string | number) => {
    if (!accountNumber) return '-'
    const accountStr = accountNumber.toString().padStart(10, '0')  // Padding para 10 dígitos (9+1)
    const lastDigit = accountStr.slice(-1)
    const firstPart = accountStr.slice(0, -1)
    return `${firstPart}-${lastDigit}`
  }

  // Máscara de conta para input (sem padding, só insere o traço antes do último dígito)
  const maskAccountInput = (raw: string) => {
    if (raw.length <= 1) return raw
    return `${raw.slice(0, -1)}-${raw.slice(-1)}`
  }

  // Separar contas ativas e inativas
  const contasAtivas = contas.filter(c => c.active)
  const contasInativas = contas.filter(c => !c.active)

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <Landmark className="w-8 h-8" />
                Gerenciar Contas
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Cadastre e gerencie suas contas bancárias
              </p>
            </div>
            <button
              onClick={abrirModalNovo}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-white hover:opacity-90"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              <Plus size={20} />
              Nova Conta
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Carregando...</p>
            </div>
          ) : contas.length === 0 ? (
            <div
              className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700"
              style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
            >
              <Building2 size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Nenhuma conta cadastrada
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Comece adicionando sua primeira conta bancária
              </p>
              <button
                onClick={abrirModalNovo}
                className="px-4 py-2 rounded-lg text-white hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                Adicionar Conta
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Contas Ativas */}
              {contasAtivas.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '4%' }}>
                          #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '11%' }}>
                          Nome
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '17%' }}>
                          Banco
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '14%' }}>
                          Descrição
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '8%' }}>
                          Agência
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '9%' }}>
                          Conta
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '11%' }}>
                          Tipo
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '13%' }}>
                          Última Atualização
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '13%' }}>
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {contasAtivas.map((conta, index) => {
                        const accountTypeColor = conta.account_type === 'corrente' ? '1' : conta.account_type === 'poupanca' ? '3' : '4'

                        return (
                          <tr
                            key={conta.id}
                            className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                            onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500 dark:text-gray-400">
                              {index + 1}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div
                                  className="p-1.5 rounded-md shadow-sm flex-shrink-0"
                                  style={{ background: 'var(--gradient-1-2)' }}
                                >
                                  <Landmark size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                </div>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                  {conta.name || '-'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-gray-900 dark:text-white">
                                {conta.bank ? `${conta.bank.code} - ${conta.bank.name}` : '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {conta.description || '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                              {formatAgency(conta.agency)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                              {formatAccount(conta.account_number)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span
                                className="inline-block px-3 py-1 text-xs font-medium rounded w-[140px] text-center"
                                style={{
                                  backgroundColor: `var(--color-${accountTypeColor})`,
                                  color: 'white'
                                }}
                              >
                                {getAccountTypeLabel(conta.account_type)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                              {conta.last_updated_at
                                ? new Date(conta.last_updated_at).toLocaleDateString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric'
                                  })
                                : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => abrirModalEditar(conta)}
                                  className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                  title="Editar"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  onClick={() => handleInativar(conta.id)}
                                  className="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300"
                                  title="Inativar"
                                >
                                  <Archive size={16} />
                                </button>
                                <button
                                  onClick={() => handleDelete(conta.id)}
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
                    </tbody>
                  </table>
                </div>
              )}

              {/* Divisor para Contas Inativas */}
              {contasInativas.length > 0 && (
                <>
                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t-2 border-gray-300 dark:border-gray-600"></div>
                    </div>
                    <div className="relative flex justify-center">
                      <span className="px-4 bg-gray-100 dark:bg-gray-900 text-sm font-medium text-gray-500 dark:text-gray-400">
                        Contas Inativas
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
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '11%' }}>
                            Nome
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '17%' }}>
                            Banco
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '14%' }}>
                            Descrição
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '8%' }}>
                            Agência
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '9%' }}>
                            Conta
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '11%' }}>
                            Tipo
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '13%' }}>
                            Última Atualização
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '13%' }}>
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {contasInativas.map((conta, index) => {
                          const accountTypeColor = conta.account_type === 'corrente' ? '1' : conta.account_type === 'poupanca' ? '3' : '4'

                          return (
                            <tr
                              key={conta.id}
                              className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                              onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500 dark:text-gray-400">
                                {index + 1}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="p-1.5 rounded-md shadow-sm flex-shrink-0"
                                    style={{ background: 'var(--gradient-1-2)' }}
                                  >
                                    <Landmark size={16} style={{ color: 'var(--on-gradient-1-2)' }} />
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {conta.name || '-'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-900 dark:text-white">
                                  {conta.bank ? `${conta.bank.code} - ${conta.bank.name}` : '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {conta.description || '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                                {formatAgency(conta.agency)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                                {formatAccount(conta.account_number)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span
                                  className="inline-block px-3 py-1 text-xs font-medium rounded w-[140px] text-center"
                                  style={{
                                    backgroundColor: `var(--color-${accountTypeColor})`,
                                    color: 'white'
                                  }}
                                >
                                  {getAccountTypeLabel(conta.account_type)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600 dark:text-gray-400">
                                {conta.last_updated_at
                                  ? new Date(conta.last_updated_at).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric'
                                    })
                                  : '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => abrirModalEditar(conta)}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                    title="Editar"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleReativar(conta.id)}
                                    className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300"
                                    title="Reativar"
                                  >
                                    <RotateCcw size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(conta.id)}
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
                      </tbody>
                    </table>
                  </div>
                </>
              )}
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
                  {editingConta ? 'Editar Conta' : 'Nova Conta'}
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nome *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: Conta Itaú Principal"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Banco *
                    </label>
                    <select
                      value={formData.bank_id}
                      onChange={(e) => setFormData({ ...formData, bank_id: e.target.value })}
                      required
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Selecione um banco...</option>
                      {[...bancos]
                        .sort((a, b) => parseInt(a.code) - parseInt(b.code))
                        .map((banco) => (
                          <option key={banco.id} value={banco.id}>
                            {banco.code} - {banco.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Descrição (opcional)
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: Conta corrente principal"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tipo de Conta
                    </label>
                    <select
                      value={formData.account_type}
                      onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Selecione...</option>
                      <option value="corrente">Conta Corrente</option>
                      <option value="poupanca">Poupança</option>
                      <option value="investimento">Investimento</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Agência
                    </label>
                    <input
                      type="text"
                      value={maskAgencyInput(formData.agency)}
                      onChange={(e) => {
                        const onlyNumbers = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setFormData({ ...formData, agency: onlyNumbers })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: 12345-6"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Número da Conta
                    </label>
                    <input
                      type="text"
                      value={maskAccountInput(formData.account_number)}
                      onChange={(e) => {
                        const onlyNumbers = e.target.value.replace(/\D/g, '').slice(0, 10)
                        setFormData({ ...formData, account_number: onlyNumbers })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Ex: 304654-7"
                    />
                  </div>
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
                    {editingConta ? 'Atualizar' : 'Criar'}
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

export default ContasPage

