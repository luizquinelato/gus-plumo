import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import IconPicker from '../components/IconPicker'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  Plus, Edit2, Trash2, Tag, Search,
  ChevronDown, ChevronRight, X
} from 'lucide-react'
import { getIconComponent } from '../utils/iconMapper'
import { useConfirm } from '../hooks/useConfirm'

// Interfaces
interface TagItem {
  id: number
  name: string
  description: string | null
  icon: string | null
  active: boolean
}

interface SubtagItem {
  id: number
  tag_id: number
  name: string
  description: string | null
  type: string
  icon: string | null
  active: boolean
  tag_name: string | null
}

interface HierarchicalData {
  tag: TagItem
  subtags: SubtagItem[]
  subtagsCount: number
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const TagsSubtagsPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()

  const [hierarchicalData, setHierarchicalData] = useState<HierarchicalData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [availableIcons, setAvailableIcons] = useState<string[]>([])
  const [iconNamesPt, setIconNamesPt] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Estados de expansão
  const [expandedTags, setExpandedTags] = useState<Set<number>>(new Set())
  
  // Estados de modais
  const [showTagModal, setShowTagModal] = useState(false)
  const [showSubtagModal, setShowSubtagModal] = useState(false)
  
  // Estados de edição
  const [editingTag, setEditingTag] = useState<TagItem | null>(null)
  const [editingSubtag, setEditingSubtag] = useState<SubtagItem | null>(null)
  
  // Contexto para criação (qual tag está sendo usada)
  const [contextTagId, setContextTagId] = useState<number | null>(null)
  
  // Form data
  const [tagFormData, setTagFormData] = useState({
    name: '',
    description: '',
    icon: 'Tag',
    createOutroSubtags: true
  })

  const [subtagFormData, setSubtagFormData] = useState({
    tag_id: 0,
    name: '',
    description: '',
    type: 'despesa',
    icon: 'Tags'
  })

  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    try {
      setIsLoading(true)

      // Carregar tags, subtags, ícones disponíveis e nomes em português
      const [tagsRes, subtagsRes, iconsRes, iconNamesPtRes] = await Promise.all([
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expenses/available-icons'),
        axios.get('/api/expenses/icon-names-pt')
      ])

      setAvailableIcons(iconsRes.data)
      setIconNamesPt(iconNamesPtRes.data)

      const tags: TagItem[] = tagsRes.data
      const subtags: SubtagItem[] = subtagsRes.data

      // Organizar dados hierarquicamente
      const hierarchical: HierarchicalData[] = tags.map(tag => {
        const tagSubtags = subtags
          .filter(st => st.tag_id === tag.id)
          .sort((a, b) => a.name.localeCompare(b.name)) // Ordenar alfabeticamente

        return {
          tag,
          subtags: tagSubtags,
          subtagsCount: tagSubtags.length
        }
      })

      setHierarchicalData(hierarchical)
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Atalhos de teclado para modais
  useEffect(() => {
    if (!showTagModal && !showSubtagModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (showTagModal) setShowTagModal(false)
        if (showSubtagModal) setShowSubtagModal(false)
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
  }, [showTagModal, showSubtagModal])

  // Funções de expansão/colapso
  const toggleTag = (tagId: number) => {
    const newExpanded = new Set(expandedTags)
    if (newExpanded.has(tagId)) {
      newExpanded.delete(tagId)
    } else {
      newExpanded.add(tagId)
    }
    setExpandedTags(newExpanded)
  }

  const expandAll = () => {
    const allTagIds = hierarchicalData.map(h => h.tag.id)
    setExpandedTags(new Set(allTagIds))
  }

  const collapseAll = () => {
    setExpandedTags(new Set())
  }

  // Funções CRUD para Tags
  const handleCreateTag = () => {
    setEditingTag(null)
    setTagFormData({ name: '', description: '', icon: 'Tag', createOutroSubtags: true })
    setShowTagModal(true)
  }

  const handleEditTag = (tag: TagItem) => {
    setEditingTag(tag)
    setTagFormData({
      name: tag.name,
      description: tag.description || '',
      icon: tag.icon || 'Tag',
      createOutroSubtags: false
    })
    setShowTagModal(true)
  }

  const handleSubmitTag = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingTag) {
        // Edição: não cria subtags "Outro"
        const { createOutroSubtags, ...tagData } = tagFormData
        await axios.put(`/api/expenses/tags/${editingTag.id}`, tagData)
        showToast('Tag atualizada com sucesso!', 'success')
      } else {
        // Criação: cria a tag
        const { createOutroSubtags, ...tagData } = tagFormData
        const response = await axios.post('/api/expenses/tags', tagData)
        const newTagId = response.data.id

        // Se a flag estiver marcada, cria as subtags "Outro"
        if (createOutroSubtags) {
          await axios.post('/api/expenses/subtags', {
            tag_id: newTagId,
            name: 'Outro',
            description: 'Outras despesas',
            type: 'despesa',
            icon: 'HelpCircle'
          })
          await axios.post('/api/expenses/subtags', {
            tag_id: newTagId,
            name: 'Outro',
            description: 'Outras receitas',
            type: 'receita',
            icon: 'HelpCircle'
          })
        }
        showToast('Tag criada com sucesso!', 'success')
      }
      setShowTagModal(false)
      setEditingTag(null)
      loadAllData()
    } catch (error: any) {
      console.error('Erro ao salvar tag:', error)
      showToast(error.response?.data?.detail || 'Erro ao salvar tag', 'error')
    }
  }

  const handleDeleteTag = async (tagId: number) => {
    try {
      // Verifica quantos registros estão associados
      const usageResponse = await axios.get(`/api/expenses/tags/${tagId}/usage-count`)
      const { total_count, bank_statements_count, credit_card_invoices_count, tag_name } = usageResponse.data

      let message = `Deletar a tag "${tag_name}"?`

      if (total_count > 0) {
        message += `\n\n⚠️ ${total_count} registro(s) associado(s):`

        if (bank_statements_count > 0) {
          message += `\n• ${bank_statements_count} extrato(s) bancário(s)`
        }
        if (credit_card_invoices_count > 0) {
          message += `\n• ${credit_card_invoices_count} fatura(s) de cartão`
        }

        message += `\n\n→ Serão migrados para "Pendente"`
      }

      message += '\n\nTodas as subtags também serão deletadas.'

      showConfirm(
        'Deletar Tag',
        message,
        async () => {
          try {
            // Usa force delete para migrar registros
            await axios.delete(`/api/expenses/tags/${tagId}/force`)
            loadAllData()

            if (total_count > 0) {
              showToast(`Tag deletada e ${total_count} registro(s) migrados para "Pendente"`, 'success')
            } else {
              showToast('Tag deletada com sucesso!', 'success')
            }
          } catch (error: any) {
            console.error('Erro ao deletar tag:', error)
            const errorMsg = error.response?.data?.detail || 'Não foi possível deletar a tag.'
            showToast(errorMsg, 'error')
          }
        },
        'Deletar',
        'Cancelar'
      )
    } catch (error) {
      console.error('Erro ao verificar uso da tag:', error)
      showToast('Não foi possível verificar o uso da tag.', 'error')
    }
  }

  // Funções CRUD para Subtags
  const handleCreateSubtag = (tagId: number) => {
    setEditingSubtag(null)
    setContextTagId(tagId)
    setSubtagFormData({ tag_id: tagId, name: '', description: '', type: 'despesa', icon: 'Tags' })
    setShowSubtagModal(true)
  }

  const handleEditSubtag = (subtag: SubtagItem) => {
    setEditingSubtag(subtag)
    setSubtagFormData({
      tag_id: subtag.tag_id,
      name: subtag.name,
      description: subtag.description || '',
      type: subtag.type,
      icon: subtag.icon || 'Tags'
    })
    setShowSubtagModal(true)
  }

  const handleSubmitSubtag = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingSubtag) {
        await axios.put(`/api/expenses/subtags/${editingSubtag.id}`, subtagFormData)
        showToast('Subtag atualizada com sucesso!', 'success')
      } else {
        await axios.post('/api/expenses/subtags', subtagFormData)
        showToast('Subtag criada com sucesso!', 'success')
      }
      setShowSubtagModal(false)
      setEditingSubtag(null)
      setContextTagId(null)
      loadAllData()
    } catch (error: any) {
      console.error('Erro ao salvar subtag:', error)
      showToast(error.response?.data?.detail || 'Erro ao salvar subtag', 'error')
    }
  }

  const handleDeleteSubtag = async (subtagId: number) => {
    try {
      // Verifica quantos registros estão associados
      const usageResponse = await axios.get(`/api/expenses/subtags/${subtagId}/usage-count`)
      const { total_count, bank_statements_count, credit_card_invoices_count, subtag_name } = usageResponse.data

      let message = `Deletar a subtag "${subtag_name}"?`

      if (total_count > 0) {
        message += `\n\n⚠️ ${total_count} registro(s) associado(s):`

        if (bank_statements_count > 0) {
          message += `\n• ${bank_statements_count} extrato(s) bancário(s)`
        }
        if (credit_card_invoices_count > 0) {
          message += `\n• ${credit_card_invoices_count} fatura(s) de cartão`
        }

        message += `\n\n→ Serão migrados para "Pendente"`
      }

      showConfirm(
        'Deletar Subtag',
        message,
        async () => {
          try {
            // Usa force delete para migrar registros
            await axios.delete(`/api/expenses/subtags/${subtagId}/force`)
            loadAllData()

            if (total_count > 0) {
              showToast(`Subtag deletada e ${total_count} registro(s) migrados para "Pendente"`, 'success')
            } else {
              showToast('Subtag deletada com sucesso!', 'success')
            }
          } catch (error: any) {
            console.error('Erro ao deletar subtag:', error)
            const errorMsg = error.response?.data?.detail || 'Não foi possível deletar a subtag.'
            showToast(errorMsg, 'error')
          }
        },
        'Deletar',
        'Cancelar'
      )
    } catch (error) {
      console.error('Erro ao verificar uso da subtag:', error)
      showToast('Não foi possível verificar o uso da subtag.', 'error')
    }
  }

  // Filtro de busca
  const filteredData = hierarchicalData.filter(item => {
    const tagMatch = item.tag.name.toLowerCase().includes(searchTerm.toLowerCase())
    const subtagMatch = item.subtags.some(st =>
      st.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    return tagMatch || subtagMatch
  })

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                <Tag className="w-8 h-8" />
                Tags e Subtags
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Gerencie suas tags e subtags de categorização
              </p>
            </div>
            <div className="flex gap-3">
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
                Colapsar Tudo
              </button>
              <button
                onClick={handleCreateTag}
                className="px-4 py-2 rounded-md hover:opacity-90 flex items-center gap-2 text-white"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                <Plus size={20} />
                Nova Tag
              </button>
            </div>
          </div>
          {/* Barra de busca */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Buscar tags ou subtags..."
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
          ) : filteredData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Tag size={48} className="text-gray-400 mb-4" />
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                {searchTerm ? 'Nenhum resultado encontrado' : 'Nenhuma tag cadastrada'}
              </p>
              {!searchTerm && (
                <button
                  onClick={handleCreateTag}
                  className="mt-4 px-4 py-2 rounded-md hover:opacity-90 text-white"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  Criar primeira tag
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredData.map((item) => (
                <div
                  key={item.tag.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  {/* Tag Level */}
                  <div className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    {/* Botão de expansão */}
                    <button
                      onClick={() => toggleTag(item.tag.id)}
                      className="mr-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      {expandedTags.has(item.tag.id) ? (
                        <ChevronDown size={20} />
                      ) : (
                        <ChevronRight size={20} />
                      )}
                    </button>

                    {/* Ícone */}
                    {(() => {
                      const IconComponent = getIconComponent(item.tag.icon || 'Tag')
                      return <IconComponent size={20} className="mr-3 text-gray-600 dark:text-gray-400" />
                    })()}

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {item.tag.name}
                        </span>
                      </div>
                      {item.tag.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {item.tag.description}
                        </p>
                      )}
                    </div>

                    {/* Contador */}
                    <div className="flex items-center gap-4 mr-4">
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-medium">{item.subtagsCount}</span> subtags
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCreateSubtag(item.tag.id)}
                        className="p-2 text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300"
                        title="Nova Subtag"
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        onClick={() => handleEditTag(item.tag)}
                        className="p-2 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        title="Editar Tag"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteTag(item.tag.id)}
                        className="p-2 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                        title="Deletar Tag"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Subtags (expandido) */}
                  {expandedTags.has(item.tag.id) && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                      {item.subtags.length === 0 ? (
                        <div className="p-4 pl-16 text-sm text-gray-500 dark:text-gray-400">
                          Nenhuma subtag cadastrada
                        </div>
                      ) : (
                        <>
                          {/* Grupo: Despesas */}
                          {(() => {
                            const despesas = item.subtags.filter(st => st.type === 'despesa')
                            if (despesas.length === 0) return null

                            return (
                              <div>
                                <div className="px-4 py-2 pl-16 bg-red-50 dark:bg-red-900/10 border-b border-gray-200 dark:border-gray-700">
                                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                                    Despesas ({despesas.length})
                                  </span>
                                </div>
                                {despesas.map((subtag) => (
                                  <div key={subtag.id} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                                    {/* Subtag Level */}
                                    <div
                                      className="flex items-center p-3 pl-16 border-l-4 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all"
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.borderLeftColor = ''
                                      }}
                                    >
                                      {/* Ícone */}
                                      {(() => {
                                        const IconComponent = getIconComponent(subtag.icon || 'Tags')
                                        return <IconComponent size={18} className="mr-2 text-gray-600 dark:text-gray-400" />
                                      })()}
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium text-gray-800 dark:text-gray-200">
                                            {subtag.name}
                                          </span>
                                        </div>
                                        {subtag.description && (
                                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {subtag.description}
                                          </p>
                                        )}
                                      </div>

                                      {/* Ações */}
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => handleEditSubtag(subtag)}
                                          className="p-1.5 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                                          title="Editar Subtag"
                                        >
                                          <Edit2 size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteSubtag(subtag.id)}
                                          className="p-1.5 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                          title="Deletar Subtag"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}

                          {/* Grupo: Receitas */}
                          {(() => {
                            const receitas = item.subtags.filter(st => st.type === 'receita')
                            if (receitas.length === 0) return null

                            return (
                              <div>
                                <div className="px-4 py-2 pl-16 bg-green-50 dark:bg-green-900/10 border-b border-gray-200 dark:border-gray-700">
                                  <span className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                                    Receitas ({receitas.length})
                                  </span>
                                </div>
                                {receitas.map((subtag) => (
                                  <div key={subtag.id} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                                    {/* Subtag Level */}
                                    <div
                                      className="flex items-center p-3 pl-16 border-l-4 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all"
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.borderLeftColor = ''
                                      }}
                                    >
                                      {/* Ícone */}
                                      {(() => {
                                        const IconComponent = getIconComponent(subtag.icon || 'Tags')
                                        return <IconComponent size={18} className="mr-2 text-gray-600 dark:text-gray-400" />
                                      })()}
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium text-gray-800 dark:text-gray-200">
                                            {subtag.name}
                                          </span>
                                        </div>
                                        {subtag.description && (
                                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {subtag.description}
                                          </p>
                                        )}
                                      </div>

                                      {/* Ações */}
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => handleEditSubtag(subtag)}
                                          className="p-1.5 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                                          title="Editar Subtag"
                                        >
                                          <Edit2 size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteSubtag(subtag.id)}
                                          className="p-1.5 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                          title="Deletar Subtag"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal de Tag */}
      {showTagModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {editingTag ? 'Editar Tag' : 'Nova Tag'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowTagModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Fechar (ESC)"
                >
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmitTag}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nome *
                    </label>
                    <input
                      type="text"
                      required
                      value={tagFormData.name}
                      onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Ex: Alimentação"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Descrição
                    </label>
                    <textarea
                      value={tagFormData.description}
                      onChange={(e) => setTagFormData({ ...tagFormData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Descrição opcional"
                      rows={3}
                    />
                  </div>
                  <IconPicker
                    value={tagFormData.icon}
                    onChange={(icon) => setTagFormData({ ...tagFormData, icon })}
                    availableIcons={availableIcons}
                    iconNamesPt={iconNamesPt}
                  />
                  {!editingTag && (
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="createOutroSubtags"
                        checked={tagFormData.createOutroSubtags}
                        onChange={(e) => setTagFormData({ ...tagFormData, createOutroSubtags: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="createOutroSubtags" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        Criar automaticamente subtags "Outro" (Despesa e Receita)
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowTagModal(false)}
                    className="flex-1 px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-md hover:opacity-90 text-white"
                    style={{
                      backgroundColor: editingTag ? 'var(--crud-edit)' : 'var(--crud-create)'
                    }}
                  >
                    {editingTag ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Subtag */}
        {showSubtagModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {editingSubtag ? 'Editar Subtag' : 'Nova Subtag'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSubtagModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Fechar (ESC)"
                >
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmitSubtag}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tag *
                    </label>
                    <select
                      required
                      value={subtagFormData.tag_id}
                      onChange={(e) => setSubtagFormData({ ...subtagFormData, tag_id: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      disabled={!!contextTagId}
                    >
                      <option value={0}>Selecione uma tag</option>
                      {hierarchicalData.map(h => (
                        <option key={h.tag.id} value={h.tag.id}>
                          {h.tag.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nome *
                    </label>
                    <input
                      type="text"
                      required
                      value={subtagFormData.name}
                      onChange={(e) => setSubtagFormData({ ...subtagFormData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Ex: Restaurante"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Descrição
                    </label>
                    <textarea
                      value={subtagFormData.description}
                      onChange={(e) => setSubtagFormData({ ...subtagFormData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Descrição opcional"
                      rows={3}
                    />
                  </div>
                  <IconPicker
                    value={subtagFormData.icon}
                    onChange={(icon) => setSubtagFormData({ ...subtagFormData, icon })}
                    availableIcons={availableIcons}
                    iconNamesPt={iconNamesPt}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tipo *
                    </label>
                    <select
                      required
                      value={subtagFormData.type}
                      onChange={(e) => setSubtagFormData({ ...subtagFormData, type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="despesa">Despesa</option>
                      <option value="receita">Receita</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowSubtagModal(false)}
                    className="flex-1 px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-md hover:opacity-90 text-white"
                    style={{
                      backgroundColor: editingSubtag ? 'var(--crud-edit)' : 'var(--crud-create)'
                    }}
                  >
                    {editingSubtag ? 'Atualizar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Dialogs */}
      <ConfirmComponent />

      {/* Toast */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </div>
  )
}

export default TagsSubtagsPage

