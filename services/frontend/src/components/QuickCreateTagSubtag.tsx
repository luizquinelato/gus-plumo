import { useState, useEffect } from 'react'
import axios from 'axios'
import { X, Plus } from 'lucide-react'
import { useAlert } from '../hooks/useAlert'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface Tag {
  id: number
  name: string
  type: string
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  description?: string
  type: string
  icon?: string
  active: boolean
  tag_name?: string
}

interface QuickCreateTagSubtagProps {
  mode: 'tag' | 'subtag'
  existingTags?: Tag[]
  transactionType?: 'receita' | 'despesa'
  selectedTagId?: number
  onSuccess: (newId: number, newItem: Tag | Subtag) => void
  onClose: () => void
}

const QuickCreateTagSubtag = ({ mode, existingTags = [], transactionType = 'despesa', selectedTagId, onSuccess, onClose }: QuickCreateTagSubtagProps) => {
  const { showSuccess, showError, AlertComponent } = useAlert()
  const [isLoading, setIsLoading] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    tag_id: selectedTagId || 0,
    type: transactionType
  })

  // Hook para fechar modal com ESC
  useEscapeKey(onClose, true)

  // Hook para submeter com Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
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
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      showError('Erro', 'Nome é obrigatório')
      return
    }

    if (mode === 'subtag' && !formData.tag_id) {
      showError('Erro', 'Selecione uma tag')
      return
    }

    try {
      setIsLoading(true)

      if (mode === 'tag') {
        // Cria tag (tags não têm tipo, apenas subtags têm)
        const response = await axios.post('/api/expenses/tags', {
          name: formData.name.trim(),
          description: ''
        })

        showSuccess('Sucesso!', `Tag "${formData.name}" criada!`)
        onSuccess(response.data.id, response.data)
      } else {
        // Cria subtag
        const response = await axios.post('/api/expenses/subtags', {
          tag_id: formData.tag_id,
          name: formData.name.trim(),
          description: '',
          type: formData.type,
          icon: 'Tags'
        })

        showSuccess('Sucesso!', `Subtag "${formData.name}" criada!`)
        onSuccess(response.data.id, response.data)
      }

      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (error: any) {
      console.error('Erro ao criar:', error)
      showError(
        'Erro ao Criar',
        error.response?.data?.detail || 'Erro ao criar. Tente novamente.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <AlertComponent />
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
          <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Plus size={20} className="text-blue-600" />
              Criar {mode === 'tag' ? 'Tag' : 'Subtag'} Rápida
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Nome *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={mode === 'tag' ? 'Ex: Alimentação' : 'Ex: Restaurante'}
              />
            </div>

            {/* Tag (apenas para subtag) */}
            {mode === 'subtag' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Tag *
                </label>
                <select
                  required
                  value={formData.tag_id}
                  onChange={(e) => setFormData({ ...formData, tag_id: Number(e.target.value) })}
                  disabled={!!selectedTagId}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                >
                  <option value={0}>Selecione uma tag...</option>
                  {existingTags
                    .filter(tag => tag.type === transactionType)
                    .map(tag => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                </select>
                {selectedTagId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Tag pré-selecionada automaticamente
                  </p>
                )}
              </div>
            )}

            {/* Tipo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tipo *
              </label>
              <select
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as 'receita' | 'despesa' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </div>

            {/* Botões */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2 rounded-md text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--crud-cancel)' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-4 py-2 text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Criando...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Criar
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default QuickCreateTagSubtag

