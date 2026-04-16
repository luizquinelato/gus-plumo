import { useState, useEffect } from 'react'
import axios from 'axios'
import { X, Save, Check, Copy, Plus, Search } from 'lucide-react'
import { useAlert } from '../hooks/useAlert'
import { useEscapeKey } from '../hooks/useEscapeKey'
import QuickCreateTagSubtag from './QuickCreateTagSubtag'

interface UnmappedRecord {
  linha: number
  data: string
  descricao: string
  valor: number
  categoria?: string | null  // Para extratos bancários
  transacao?: string | null  // Para extratos bancários
  cartao?: string            // Para faturas de cartão
}

interface UnmappedRecordsModalProps {
  isOpen: boolean
  onClose: () => void
  onCloseAll?: () => void  // Callback para fechar todos os modais
  records: UnmappedRecord[]
  totalUnmapped: number
}

interface Tag {
  id: number
  name: string
  type: string
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  tag_name: string
  type: string  // 'receita' ou 'despesa' (agora tipo está na subtag)
}

const UnmappedRecordsModal = ({ isOpen, onClose, onCloseAll, records, totalUnmapped }: UnmappedRecordsModalProps) => {
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [selectedMappings, setSelectedMappings] = useState<Record<string, { tag_id: number | null, subtag_id: number | null }>>({})
  const [savedMappings, setSavedMappings] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState<string | null>(null)

  // Tags globais separadas por tipo
  const [globalReceitaTag, setGlobalReceitaTag] = useState<number | null>(null)
  const [globalReceitaSubtag, setGlobalReceitaSubtag] = useState<number | null>(null)
  const [globalDespesaTag, setGlobalDespesaTag] = useState<number | null>(null)
  const [globalDespesaSubtag, setGlobalDespesaSubtag] = useState<number | null>(null)

  const [isSavingAll, setIsSavingAll] = useState(false)
  const { showSuccess, showError, showWarning, showInfo, AlertComponent } = useAlert()

  // Checkbox para controlar se deve criar mapeamentos
  const [shouldCreateMapping] = useState(true)

  // Estados para criação rápida de tags/subtags
  const [showQuickCreateModal, setShowQuickCreateModal] = useState(false)
  const [quickCreateMode, setQuickCreateMode] = useState<'tag' | 'subtag'>('tag')
  const [quickCreateContext, setQuickCreateContext] = useState<{
    recordKey?: string
    transactionType: 'receita' | 'despesa'
  } | null>(null)

  // Paginação
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(50)

  // Busca por descrição
  const [searchQuery, setSearchQuery] = useState('')

  // Hook para fechar modal com ESC
  useEscapeKey(onClose, isOpen)

  // Hook para salvar com Enter
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          handleSaveAll()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      loadTagsAndSubtags()
      // Reseta todos os estados quando o modal é aberto
      setSelectedMappings({})
      setSavedMappings(new Set())
      setGlobalReceitaTag(null)
      setGlobalReceitaSubtag(null)
      setGlobalDespesaTag(null)
      setGlobalDespesaSubtag(null)
      setIsSaving(null)
      setIsSavingAll(false)
      setCurrentPage(1)
      setSearchQuery('')
    }
  }, [isOpen, records])

  const loadTagsAndSubtags = async () => {
    try {
      const [tagsRes, subtagsRes] = await Promise.all([
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags')
      ])
      setTags(tagsRes.data)
      setSubtags(subtagsRes.data)
    } catch (error) {
      console.error('Erro ao carregar tags/subtags:', error)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  // Para faturas, inverte o valor para exibição
  // Banco: negativo = despesa, positivo = receita
  // Exibição: positivo = despesa, negativo = receita
  const getDisplayValue = (record: UnmappedRecord) => {
    if (record.cartao) {
      // É fatura: inverte o sinal
      return -record.valor
    }
    // É extrato: mantém o sinal original
    return record.valor
  }

  // Determina se o registro é uma receita
  // Para faturas: valor ORIGINAL negativo = receita (cancelamento)
  // Para extratos: valor positivo = receita
  const isReceita = (record: UnmappedRecord) => {
    if (record.cartao) {
      // É fatura: negativo no Excel = receita (cancelamento)
      return record.valor < 0
    }
    // É extrato: positivo = receita
    return record.valor >= 0
  }

  // Determina se o registro é uma despesa
  const isDespesa = (record: UnmappedRecord) => {
    return !isReceita(record)
  }

  const formatDateTime = (dateStr: string) => {
    try {
      if (!dateStr) return 'Data inválida'

      // Parse manual para evitar problemas de timezone
      // Formato esperado: "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD"
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/)

      if (!match) {
        console.error('Formato de data inválido:', dateStr)
        return 'Data inválida'
      }

      const [, year, month, day, hour = '00', minute = '00', second = '00'] = match

      // Formata manualmente: DD/MM/YYYY HH:MM:SS
      return `${day}/${month}/${year} ${hour}:${minute}:${second}`
    } catch (error) {
      console.error('Erro ao formatar data:', dateStr, error)
      return 'Data inválida'
    }
  }

  // Gera chave única para cada registro (linha + descrição)
  const getRecordKey = (record: UnmappedRecord) => {
    return `${record.linha}-${record.descricao}`
  }

  const handleTagChange = (recordKey: string, tagId: number) => {
    setSelectedMappings(prev => ({
      ...prev,
      [recordKey]: { tag_id: tagId, subtag_id: null }
    }))
  }

  const handleSubtagChange = (recordKey: string, subtagId: number) => {
    const subtag = subtags.find(s => s.id === subtagId)
    setSelectedMappings(prev => ({
      ...prev,
      [recordKey]: { tag_id: subtag?.tag_id || null, subtag_id: subtagId }
    }))
  }

  // Funções de criação rápida
  const handleQuickCreateTag = (recordKey: string, transactionType: 'receita' | 'despesa') => {
    setQuickCreateMode('tag')
    setQuickCreateContext({ recordKey, transactionType })
    setShowQuickCreateModal(true)
  }

  const handleQuickCreateSubtag = (recordKey: string, transactionType: 'receita' | 'despesa') => {
    setQuickCreateMode('subtag')
    setQuickCreateContext({ recordKey, transactionType })
    setShowQuickCreateModal(true)
  }

  const handleQuickCreateSuccess = async (newId: number) => {
    // Recarrega tags e subtags
    await loadTagsAndSubtags()

    // Se foi criada uma tag, seleciona automaticamente
    if (quickCreateMode === 'tag' && quickCreateContext?.recordKey) {
      handleTagChange(quickCreateContext.recordKey, newId)
    }

    // Se foi criada uma subtag, seleciona automaticamente
    if (quickCreateMode === 'subtag' && quickCreateContext?.recordKey) {
      handleSubtagChange(quickCreateContext.recordKey, newId)
    }
  }

  const applyGlobalReceitas = () => {
    if (!globalReceitaTag || !globalReceitaSubtag) {
      showWarning('Seleção Incompleta', 'Por favor, selecione uma tag e subtag de receita')
      return
    }

    const newMappings: Record<string, { tag_id: number | null, subtag_id: number | null }> = {}
    let count = 0

    // Aplica apenas aos registros filtrados da página atual
    paginatedRecords.forEach(record => {
      const key = getRecordKey(record)
      if (!savedMappings.has(key) && isReceita(record)) {
        newMappings[key] = { tag_id: globalReceitaTag, subtag_id: globalReceitaSubtag }
        count++
      }
    })

    setSelectedMappings(prev => ({ ...prev, ...newMappings }))

    if (count > 0) {
      const tagName = tags.find(t => t.id === globalReceitaTag)?.name || ''
      const subtagName = subtags.find(s => s.id === globalReceitaSubtag)?.name || ''
      showSuccess('Tags Aplicadas', `Tags de receita aplicadas a ${count} registro(s) da página atual: ${tagName} / ${subtagName}`)
    } else {
      showInfo('Nenhum Registro', 'Nenhuma receita encontrada na página atual para aplicar a tag.')
    }
  }

  const applyGlobalDespesas = () => {
    if (!globalDespesaTag || !globalDespesaSubtag) {
      showWarning('Seleção Incompleta', 'Por favor, selecione uma tag e subtag de despesa')
      return
    }

    const newMappings: Record<string, { tag_id: number | null, subtag_id: number | null }> = {}
    let count = 0

    // Aplica apenas aos registros filtrados da página atual
    paginatedRecords.forEach(record => {
      const key = getRecordKey(record)
      if (!savedMappings.has(key) && isDespesa(record)) {
        newMappings[key] = { tag_id: globalDespesaTag, subtag_id: globalDespesaSubtag }
        count++
      }
    })

    setSelectedMappings(prev => ({ ...prev, ...newMappings }))

    if (count > 0) {
      const tagName = tags.find(t => t.id === globalDespesaTag)?.name || ''
      const subtagName = subtags.find(s => s.id === globalDespesaSubtag)?.name || ''
      showSuccess('Tags Aplicadas', `Tags de despesa aplicadas a ${count} registro(s) da página atual: ${tagName} / ${subtagName}`)
    } else {
      showInfo('Nenhum Registro', 'Nenhuma despesa encontrada na página atual para aplicar a tag.')
    }
  }

  const handleSaveMapping = async (recordKey: string, descricao: string) => {
    const mapping = selectedMappings[recordKey]
    if (!mapping || !mapping.subtag_id) {
      showWarning('Seleção Incompleta', 'Por favor, selecione uma subtag')
      return
    }

    setIsSaving(recordKey)
    try {
      await axios.post('/api/expenses/mappings', {
        original_description: descricao.toLowerCase(),
        subtag_id: mapping.subtag_id
      })

      setSavedMappings(prev => new Set([...prev, recordKey]))
      showSuccess('✅ Categorizado', 'Regra criada! Futuras importações desta descrição serão categorizadas automaticamente.')
      setTimeout(() => {
        setIsSaving(null)
      }, 1000)
    } catch (error: any) {
      console.error('Erro ao salvar mapeamento:', error)
      // Se o erro for de duplicado, ainda marca como salvo
      if (error.response?.status === 400 && error.response?.data?.detail?.includes('Já existe')) {
        setSavedMappings(prev => new Set([...prev, recordKey]))
        showSuccess('✅ Categorizado', 'Registro atualizado! (Regra de mapeamento já existia)')
        setTimeout(() => {
          setIsSaving(null)
        }, 1000)
      } else {
        const errorMsg = error.response?.data?.detail || 'Erro ao salvar mapeamento'
        showError('Erro ao Salvar', errorMsg)
      }
      setIsSaving(null)
    }
  }

  const handleSaveAll = async () => {
    const unsavedRecords = records.filter(r => {
      const key = getRecordKey(r)
      return !savedMappings.has(key) && selectedMappings[key]?.subtag_id
    })

    if (unsavedRecords.length === 0) {
      showWarning('Nenhum Registro', 'Nenhum registro para salvar. Selecione tag e subtag primeiro.')
      return
    }

    // Se "Mapear" estiver marcado, valida se todos têm a mesma tag/subtag
    if (shouldCreateMapping) {
      const uniqueSubtagIds = new Set(unsavedRecords.map(r => selectedMappings[getRecordKey(r)].subtag_id))

      if (uniqueSubtagIds.size > 1) {
        showWarning(
          'Tags Diferentes Detectadas',
          'Quando "Mapear" está ativado, todos os registros devem ter a mesma tag e subtag para criar uma regra de mapeamento. Desmarque "Mapear" se quiser apenas categorizar sem criar regras.'
        )
        return
      }
    }

    setIsSavingAll(true)
    try {
      if (shouldCreateMapping) {
        // Cria mapeamentos na tabela transaction_mappings
        const mappings = unsavedRecords.map(record => ({
          original_description: record.descricao.toLowerCase(),
          subtag_id: selectedMappings[getRecordKey(record)].subtag_id!,
          mapped_description: null
        }))

        const response = await axios.post('/api/expenses/mappings/bulk', {
          mappings
        })

        // Marcar todos como salvos
        const newSavedMappings = new Set(savedMappings)
        unsavedRecords.forEach(record => {
          newSavedMappings.add(getRecordKey(record))
        })
        setSavedMappings(newSavedMappings)

        // Mostrar resultado
        const { created, skipped, errors } = response.data
        const totalProcessed = created + skipped

        let message = `${totalProcessed} registro(s) categorizado(s) com sucesso!`

        // Mensagem simplificada focando no benefício para o usuário
        if (created > 0 || skipped > 0) {
          message += `\n\n✨ Futuras importações com as mesmas descrições serão categorizadas automaticamente.`
        }

        if (errors.length > 0) {
          message += `\n\n⚠️ Erros:\n${errors.join('\n')}`
          showWarning('Categorização Parcial', message, () => {
            // Fecha todos os modais após clicar em OK
            if (onCloseAll) {
              onCloseAll()
            } else {
              onClose()
            }
          })
        } else {
          showSuccess('Categorização Completa', message, () => {
            // Fecha todos os modais após clicar em OK
            if (onCloseAll) {
              onCloseAll()
            } else {
              onClose()
            }
          })
        }
      } else {
        // Apenas atualiza os registros SEM criar mapeamentos
        const updates = unsavedRecords.map(record => ({
          linha: record.linha,
          subtag_id: selectedMappings[getRecordKey(record)].subtag_id!
        }))

        await axios.post('/api/expenses/update-records', {
          updates
        })

        // Marcar todos como salvos
        const newSavedMappings = new Set(savedMappings)
        unsavedRecords.forEach(record => {
          newSavedMappings.add(getRecordKey(record))
        })
        setSavedMappings(newSavedMappings)

        showSuccess('Categorização Completa', `${unsavedRecords.length} registro(s) categorizado(s) com sucesso!\n\n⚠️ Nenhuma regra de mapeamento foi criada. Futuras importações precisarão ser categorizadas manualmente.`, () => {
          // Fecha todos os modais após clicar em OK
          if (onCloseAll) {
            onCloseAll()
          } else {
            onClose()
          }
        })
      }
    } catch (error: any) {
      console.error('Erro ao salvar mapeamentos:', error)
      const errorMsg = error.response?.data?.detail || 'Erro ao salvar mapeamentos'
      showError('Erro ao Salvar', errorMsg)
    } finally {
      setIsSavingAll(false)
    }
  }

  // Filtra subtags por tag E por tipo (receita ou despesa) - para linha individual
  const getFilteredSubtags = (tagId: number | null, record: UnmappedRecord) => {
    if (!tagId) return []
    const tipo = isReceita(record) ? 'receita' : 'despesa'
    return subtags.filter(s => s.tag_id === tagId && s.type === tipo)
  }

  // Filtra subtags por tag E por tipo - para controles globais
  const getFilteredSubtagsByType = (tagId: number | null, tipo: 'receita' | 'despesa') => {
    if (!tagId) return []
    return subtags.filter(s => s.tag_id === tagId && s.type === tipo)
  }

  // Filtra tags que possuem pelo menos uma subtag do tipo correto - para linha individual
  const getFilteredTags = (record: UnmappedRecord) => {
    const tipo = isReceita(record) ? 'receita' : 'despesa'
    // Retorna tags que têm pelo menos uma subtag do tipo correto
    const tagsWithSubtags = tags.filter(tag =>
      subtags.some(s => s.tag_id === tag.id && s.type === tipo)
    )
    return tagsWithSubtags
  }

  // Filtra tags por tipo - para controles globais
  const getFilteredTagsByType = (tipo: 'receita' | 'despesa') => {
    return tags.filter(tag =>
      subtags.some(s => s.tag_id === tag.id && s.type === tipo)
    )
  }

  // Filtro por busca
  const filteredRecords = records.filter(record => {
    if (!searchQuery.trim()) return true
    return record.descricao.toLowerCase().includes(searchQuery.toLowerCase())
  })

  // Verifica se há receitas e despesas nos registros não salvos e filtrados
  const unsavedRecords = filteredRecords.filter(r => !savedMappings.has(getRecordKey(r)))
  const hasReceitas = unsavedRecords.some(r => r.valor >= 0)
  const hasDespesas = unsavedRecords.some(r => r.valor < 0)

  // Paginação (aplicada aos registros filtrados)
  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredRecords.length / itemsPerPage)
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage
  const endIndex = itemsPerPage === -1 ? filteredRecords.length : startIndex + itemsPerPage
  const paginatedRecords = itemsPerPage === -1 ? filteredRecords : filteredRecords.slice(startIndex, endIndex)

  if (!isOpen) return null

  return (
    <>
      <AlertComponent />
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={onClose}
      >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              ⚠️ Registros Não Mapeados
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {totalUnmapped} registro(s) não foram categorizados automaticamente
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Info */}
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Crie mapeamentos</strong> para que futuras importações com as mesmas descrições sejam categorizadas automaticamente.
          </p>
        </div>

        {/* Opções Globais */}
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Aplicar categorização em massa
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400 italic">
              (Aplica apenas aos {paginatedRecords.length} registro(s) da página atual)
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Seção de Receitas */}
            {hasReceitas && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">💰 Tag de Receita</label>
                  <select
                    value={globalReceitaTag || ''}
                    onChange={(e) => {
                      setGlobalReceitaTag(Number(e.target.value))
                      setGlobalReceitaSubtag(null)
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  >
                    <option value="">Selecione</option>
                    {getFilteredTagsByType('receita').map(tag => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">Subtag de Receita</label>
                  <select
                    value={globalReceitaSubtag || ''}
                    onChange={(e) => setGlobalReceitaSubtag(Number(e.target.value))}
                    disabled={!globalReceitaTag}
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
                  >
                    <option value="">Selecione</option>
                    {getFilteredSubtagsByType(globalReceitaTag, 'receita').map(subtag => (
                      <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={applyGlobalReceitas}
                  disabled={!globalReceitaTag || !globalReceitaSubtag || savedMappings.size === records.length}
                  className="flex items-center justify-center gap-2 px-4 py-1.5 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap w-44"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  <Copy size={16} />
                  Aplicar Receitas
                </button>
              </div>
            )}

            {/* Seção de Despesas */}
            {hasDespesas && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">💸 Tag de Despesa</label>
                  <select
                    value={globalDespesaTag || ''}
                    onChange={(e) => {
                      setGlobalDespesaTag(Number(e.target.value))
                      setGlobalDespesaSubtag(null)
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  >
                    <option value="">Selecione</option>
                    {getFilteredTagsByType('despesa').map(tag => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">Subtag de Despesa</label>
                  <select
                    value={globalDespesaSubtag || ''}
                    onChange={(e) => setGlobalDespesaSubtag(Number(e.target.value))}
                    disabled={!globalDespesaTag}
                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
                  >
                    <option value="">Selecione</option>
                    {getFilteredSubtagsByType(globalDespesaTag, 'despesa').map(subtag => (
                      <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={applyGlobalDespesas}
                  disabled={!globalDespesaTag || !globalDespesaSubtag || savedMappings.size === records.length}
                  className="flex items-center justify-center gap-2 px-4 py-1.5 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap w-44"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  <Copy size={16} />
                  Aplicar Despesas
                </button>
              </div>
            )}

            {/* Botão Salvar Todos - Separado e destacado */}
            <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSaveAll}
                disabled={
                  isSavingAll ||
                  savedMappings.size === records.length ||
                  !records.some(r => {
                    const key = getRecordKey(r)
                    const mapping = selectedMappings[key]
                    return !savedMappings.has(key) && mapping?.tag_id && mapping?.subtag_id
                  })
                }
                className="flex items-center justify-center gap-2 px-4 py-1.5 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium w-44"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                <Save size={16} />
                {isSavingAll ? 'Salvando...' : 'Salvar Todos'}
              </button>
            </div>
          </div>
        </div>

        {/* Campo de Busca */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1) // Volta para a primeira página ao buscar
              }}
              placeholder="Buscar por descrição..."
              className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={20} />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Mostrando {filteredRecords.length} de {records.length} registro(s)
            </p>
          )}
        </div>

        {/* Tabela de Registros */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Data</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Descrição</th>
                {records.some(r => r.cartao) && (
                  <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Cartão</th>
                )}
                <th className="px-2 py-1.5 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">Valor</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Tag</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Subtag</th>
                <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-700 dark:text-gray-300">Ação</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.map((record) => {
                const recordKey = getRecordKey(record)
                const mapping = selectedMappings[recordKey]
                const isSaved = savedMappings.has(recordKey)
                const isCurrentlySaving = isSaving === recordKey

                return (
                  <tr
                    key={recordKey}
                    className={`border-b border-gray-200 dark:border-gray-700 ${
                      isSaved
                        ? 'bg-green-50 dark:bg-green-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white whitespace-nowrap text-xs">{formatDateTime(record.data)}</td>
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white text-xs">{record.descricao}</td>
                    {records.some(r => r.cartao) && (
                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                        {record.cartao ? `****${record.cartao}` : '-'}
                      </td>
                    )}
                    <td className={`px-2 py-1.5 text-right font-semibold whitespace-nowrap text-xs ${
                      getDisplayValue(record) >= 0
                        ? 'text-gray-900 dark:text-white'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {formatCurrency(getDisplayValue(record))}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <select
                          value={mapping?.tag_id || ''}
                          onChange={(e) => handleTagChange(recordKey, Number(e.target.value))}
                          disabled={isSaved}
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                        >
                          <option value="">Tag...</option>
                          {getFilteredTags(record).map(tag => (
                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                          ))}
                        </select>
                        {!isSaved && (
                          <button
                            onClick={() => handleQuickCreateTag(recordKey, isReceita(record) ? 'receita' : 'despesa')}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors flex-shrink-0"
                            title="Criar nova tag"
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <select
                          value={mapping?.subtag_id || ''}
                          onChange={(e) => handleSubtagChange(recordKey, Number(e.target.value))}
                          disabled={!mapping?.tag_id || isSaved}
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                        >
                          <option value="">Subtag...</option>
                          {getFilteredSubtags(mapping?.tag_id || null, record).map(subtag => (
                            <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                          ))}
                        </select>
                        {!isSaved && (
                          <button
                            onClick={() => handleQuickCreateSubtag(recordKey, isReceita(record) ? 'receita' : 'despesa')}
                            disabled={!mapping?.tag_id}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                            title="Criar nova subtag"
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isSaved ? (
                        <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                          <Check size={14} />
                          <span className="text-xs">Salvo</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleSaveMapping(recordKey, record.descricao)}
                          disabled={!mapping?.subtag_id || isCurrentlySaving}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-xs mx-auto"
                        >
                          <Save size={12} />
                          {isCurrentlySaving ? 'Salvando...' : 'Salvar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Controles de Paginação */}
        <div className="mt-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              Registros por página:
            </label>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={-1}>Todos</option>
            </select>
          </div>

          {itemsPerPage !== -1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Página {currentPage} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Próxima
              </button>
            </div>
          )}

          <div className="text-sm text-gray-600 dark:text-gray-400">
            Mostrando {startIndex + 1}-{Math.min(endIndex, records.length)} de {records.length}
          </div>
        </div>

        <div className="mt-4 flex justify-between items-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {savedMappings.size} de {records.length} registros categorizados
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
            style={{ backgroundColor: 'var(--crud-cancel)' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>

    {/* Modal de Criação Rápida */}
    {showQuickCreateModal && quickCreateContext && (
      <QuickCreateTagSubtag
        mode={quickCreateMode}
        existingTags={tags}
        transactionType={quickCreateContext.transactionType}
        onSuccess={handleQuickCreateSuccess}
        onClose={() => {
          setShowQuickCreateModal(false)
          setQuickCreateContext(null)
        }}
      />
    )}
    </>
  )
}

export default UnmappedRecordsModal

