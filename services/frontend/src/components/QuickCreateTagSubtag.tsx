import { useState, useEffect } from 'react'
import axios from 'axios'
import { Plus, Tag as TagIcon } from 'lucide-react'
import { useAlert } from '../hooks/useAlert'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  cadastroFieldCls,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'

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
      <CadastroModalShell maxWidth="max-w-md" zClass="z-[110]" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit={false}
          title={`Criar ${mode === 'tag' ? 'Tag' : 'Subtag'} Rápida`}
          onClose={onClose}
          icon={<Plus size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="quick-create-tag-form">
          <CadastroModalBody>
            <CadastroFormSection title="Identificação" icon={<TagIcon size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={`${cadastroFieldCls} mt-0.5`}
                      placeholder={mode === 'tag' ? 'Ex: Alimentação' : 'Ex: Restaurante'}
                    />
                  </label>
                </CadastroModalFieldsRow>
                {mode === 'subtag' && (
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Tag</CadastroFieldLabel>
                      <select
                        required
                        value={formData.tag_id}
                        onChange={(e) => setFormData({ ...formData, tag_id: Number(e.target.value) })}
                        disabled={!!selectedTagId}
                        className={`${cadastroFieldCls} mt-0.5 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-800`}
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
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Tag pré-selecionada automaticamente
                        </p>
                      )}
                    </label>
                  </CadastroModalFieldsRow>
                )}
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Tipo</CadastroFieldLabel>
                    <select
                      required
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as 'receita' | 'despesa' })}
                      className={`${cadastroFieldCls} mt-0.5`}
                    >
                      <option value="despesa">Despesa</option>
                      <option value="receita">Receita</option>
                    </select>
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={onClose}
            onSave={() => {
              const form = document.getElementById('quick-create-tag-form') as HTMLFormElement | null
              form?.requestSubmit()
            }}
            saving={isLoading}
            disabled={isLoading}
            saveLabel={isLoading ? 'Criando...' : 'Criar'}
            saveIcon={<Plus size={15} />}
          />
        </form>
      </CadastroModalShell>
    </>
  )
}

export default QuickCreateTagSubtag
