import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import TemplateFormModal from '../components/TemplateFormModal'
import ApplyTemplateModal from '../components/ApplyTemplateModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { Plus, Edit2, Trash2, FileText, Play, RotateCcw, ChevronDown, ChevronRight, ArrowDownCircle, ArrowUpCircle, Search, X } from 'lucide-react'
import { getIconComponent } from '../utils/iconMapper'
import { useConfirm } from '../hooks/useConfirm'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate } from '../types/expenseTemplate'
import * as templatesApi from '../services/expenseTemplatesApi'
import axios from 'axios'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const ExpenseTemplatesPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const { AlertComponent } = useAlert()

  const [templates, setTemplates] = useState<ExpenseTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showFormModal, setShowFormModal] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ExpenseTemplate | null>(null)
  const [applyingTemplate, setApplyingTemplate] = useState<ExpenseTemplate | null>(null)
  const [availableIcons, setAvailableIcons] = useState<string[]>([])
  const [iconNamesPt, setIconNamesPt] = useState<Record<string, string>>({})

  // Estado de expansão
  const [expandedTemplates, setExpandedTemplates] = useState<Set<number>>(new Set())

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    loadTemplates()
    loadIcons()
  }, [incluirInativos])

  const loadTemplates = async () => {
    try {
      setIsLoading(true)
      const data = await templatesApi.listTemplates(incluirInativos)
      setTemplates(data)
    } catch (error: any) {
      console.error('Erro ao carregar templates:', error)
      // Só mostra toast de erro se não for o primeiro carregamento
      if (!isFirstLoad) {
        showToast(error.response?.data?.detail || 'Erro ao carregar templates', 'error')
      }
    } finally {
      setIsLoading(false)
      if (isFirstLoad) {
        setIsFirstLoad(false)
      }
    }
  }

  const loadIcons = async () => {
    try {
      const [iconsRes, iconNamesPtRes] = await Promise.all([
        axios.get('/api/expenses/available-icons'),
        axios.get('/api/expenses/icon-names-pt')
      ])
      setAvailableIcons(iconsRes.data)
      setIconNamesPt(iconNamesPtRes.data)
    } catch (error) {
      console.error('Erro ao carregar ícones:', error)
    }
  }

  // Funções de expansão/colapso
  const toggleTemplate = (templateId: number) => {
    const newExpanded = new Set(expandedTemplates)
    if (newExpanded.has(templateId)) {
      newExpanded.delete(templateId)
    } else {
      newExpanded.add(templateId)
    }
    setExpandedTemplates(newExpanded)
  }

  const expandAll = () => {
    const allTemplateIds = templates.map(t => t.id)
    setExpandedTemplates(new Set(allTemplateIds))
  }

  const collapseAll = () => {
    setExpandedTemplates(new Set())
  }

  const handleDelete = (template: ExpenseTemplate) => {
    showConfirm(
      'Confirmar exclusão',
      `Tem certeza que deseja excluir o template "${template.name}"?`,
      async () => {
        try {
          await templatesApi.deleteTemplate(template.id)
          showToast('Template excluído com sucesso!', 'success')
          loadTemplates()
        } catch (error: any) {
          console.error('Erro ao excluir template:', error)
          showToast(error.response?.data?.detail || 'Erro ao excluir template', 'error')
        }
      }
    )
  }

  const handleRestore = async (template: ExpenseTemplate) => {
    try {
      await templatesApi.updateTemplate(template.id, { active: true })
      showToast('Template restaurado com sucesso!', 'success')
      loadTemplates()
    } catch (error: any) {
      console.error('Erro ao restaurar template:', error)
      showToast(error.response?.data?.detail || 'Erro ao restaurar template', 'error')
    }
  }

  const handleApply = (template: ExpenseTemplate) => {
    setApplyingTemplate(template)
    setShowApplyModal(true)
  }

  const handleCreate = () => {
    setEditingTemplate(null)
    setShowFormModal(true)
  }

  const handleEdit = (template: ExpenseTemplate) => {
    setEditingTemplate(template)
    setShowFormModal(true)
  }

  const handleFormSuccess = () => {
    showToast(editingTemplate ? 'Template atualizado com sucesso!' : 'Template criado com sucesso!', 'success')
    loadTemplates()
  }

  const handleApplySuccess = () => {
    showToast('Lançamentos criados com sucesso!', 'success')
  }

  // Filtrar templates por termo de busca
  const filteredTemplates = templates.filter(template => {
    if (!searchTerm) return true

    const searchLower = searchTerm.toLowerCase()

    // Busca no nome e descrição do template
    const matchesTemplate =
      template.name.toLowerCase().includes(searchLower) ||
      (template.description && template.description.toLowerCase().includes(searchLower))

    // Busca nos itens do template
    const matchesItems = template.items?.some(item =>
      item.description.toLowerCase().includes(searchLower)
    )

    return matchesTemplate || matchesItems
  })

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <FileText className="w-8 h-8" />
                Templates de Lançamentos
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Crie templates reutilizáveis para agilizar lançamentos recorrentes
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setIncluirInativos(!incluirInativos)}
                className={`px-4 py-2 text-sm border rounded-md transition-colors ${
                  incluirInativos
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {incluirInativos ? 'Ocultar Inativos' : 'Incluir Inativos'}
              </button>
              <button
                onClick={expandAll}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Expandir Tudo
              </button>
              <button
                onClick={collapseAll}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Recolher Tudo
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 rounded-md hover:opacity-90 flex items-center gap-2 text-white"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                <Plus size={20} />
                Novo Template
              </button>
            </div>
          </div>
          {/* Barra de busca */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Buscar templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:border-color-primary focus:outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          </div>


          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner message="Carregando..." />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <FileText size={48} className="text-gray-400 mb-4" />
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                {searchTerm ? 'Nenhum resultado encontrado' : incluirInativos ? 'Nenhum template encontrado' : 'Nenhum template ativo encontrado'}
              </p>
              {!searchTerm && !incluirInativos && (
                <button
                  onClick={handleCreate}
                  className="mt-4 px-4 py-2 rounded-md hover:opacity-90 text-white"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  Criar primeiro template
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTemplates.map((template) => {
                const IconComponent = getIconComponent(template.icon)
                const isExpanded = expandedTemplates.has(template.id)

                return (
                  <div
                    key={template.id}
                    className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border transition-all overflow-hidden ${
                      template.active
                        ? 'border-gray-200 dark:border-gray-700'
                        : 'border-gray-300 dark:border-gray-600 opacity-70'
                    }`}
                  >
                    {/* Template Level */}
                    <div className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      {/* Botão de expansão */}
                      <button
                        onClick={() => toggleTemplate(template.id)}
                        className="mr-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {isExpanded ? (
                          <ChevronDown size={20} />
                        ) : (
                          <ChevronRight size={20} />
                        )}
                      </button>

                      {/* Ícone */}
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg mr-3">
                        <IconComponent className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>

                      {/* Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {template.name}
                          </span>
                          {!template.active && (
                            <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                              Inativo
                            </span>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {template.description}
                          </p>
                        )}
                      </div>

                      {/* Contador */}
                      <div className="flex items-center gap-4 mr-4">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          <span className="font-medium">{template.items.length}</span> {template.items.length === 1 ? 'item' : 'itens'}
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-2">
                        {template.active ? (
                          <>
                            <button
                              onClick={() => handleApply(template)}
                              className="p-2 text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300"
                              title="Usar template"
                            >
                              <Play size={18} />
                            </button>
                            <button
                              onClick={() => handleEdit(template)}
                              className="p-2 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                              title="Editar"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button
                              onClick={() => handleDelete(template)}
                              className="p-2 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                              title="Excluir"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleRestore(template)}
                            className="p-2 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                            title="Restaurar template"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items (expandido) */}
                    {isExpanded && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                        {template.items.length === 0 ? (
                          <div className="p-4 pl-16 text-sm text-gray-500 dark:text-gray-400">
                            Nenhum item cadastrado
                          </div>
                        ) : (
                          <div>
                            {/* Cabeçalho */}
                            <div className="grid grid-cols-[0.5fr_0.5fr_1.5fr_1fr_1fr_1fr_0.7fr_1.5fr] gap-3 p-2.5 pl-4 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">#</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Tipo</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Descrição</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Tag</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Subtag</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Valor</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Dia</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Compartilhamento</span>
                              </div>
                            </div>

                            {/* Items */}
                            <div className="divide-y divide-gray-200 dark:divide-gray-700">
                            {template.items.map((item, index) => (
                              <div
                                key={item.id}
                                className="grid grid-cols-[0.5fr_0.5fr_1.5fr_1fr_1fr_1fr_0.7fr_1.5fr] gap-3 p-2.5 pl-4 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all text-sm items-center"
                                style={{
                                  borderLeftColor: 'rgb(209 213 219)' // gray-300
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'rgb(209 213 219)'
                                }}
                              >
                                {/* Número */}
                                <div>
                                  <span className="font-medium text-gray-500 dark:text-gray-400">
                                    #{index + 1}
                                  </span>
                                </div>

                                {/* Tipo (Ícone) */}
                                <div>
                                  {item.subtag && (
                                    item.subtag.type === 'receita'
                                      ? <ArrowUpCircle size={14} className="text-green-600 dark:text-green-400" title="Receita" />
                                      : <ArrowDownCircle size={14} className="text-red-600 dark:text-red-400" title="Despesa" />
                                  )}
                                </div>

                                {/* Descrição */}
                                <div className="min-w-0">
                                  <span className="font-medium text-gray-800 dark:text-gray-200">
                                    {item.description}
                                  </span>
                                </div>

                                {/* Tag */}
                                <div className="min-w-0">
                                  <span className="text-gray-700 dark:text-gray-300">
                                    {item.subtag ? item.subtag.tag_name : '-'}
                                  </span>
                                </div>

                                {/* Subtag */}
                                <div className="min-w-0">
                                  <span className="text-gray-700 dark:text-gray-300">
                                    {item.subtag ? item.subtag.name : '-'}
                                  </span>
                                </div>

                                {/* Valor */}
                                <div className="min-w-0">
                                  {item.amount ? (
                                    <span className={`font-semibold ${item.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500 italic">-</span>
                                  )}
                                </div>

                                {/* Dia do mês */}
                                <div className="min-w-0">
                                  {item.day_of_month ? (
                                    <span className="text-gray-700 dark:text-gray-300 font-medium">
                                      {item.day_of_month}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500 italic">-</span>
                                  )}
                                </div>

                                {/* Compartilhamento */}
                                <div className="min-w-0">
                                  <SharedAccountDisplay
                                    account={item.expense_sharing?.shared_account}
                                    ownershipPercentage={item.ownership_percentage || 100}
                                  />
                                </div>
                              </div>
                            ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      <TemplateFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false)
          setEditingTemplate(null)
        }}
        onSuccess={handleFormSuccess}
        template={editingTemplate}
        availableIcons={availableIcons}
        iconNamesPt={iconNamesPt}
      />

      <ApplyTemplateModal
        isOpen={showApplyModal}
        onClose={() => {
          setShowApplyModal(false)
          setApplyingTemplate(null)
        }}
        onSuccess={handleApplySuccess}
        template={applyingTemplate}
      />

      <ConfirmComponent />
      <AlertComponent />
    </div>
  )
}

export default ExpenseTemplatesPage

