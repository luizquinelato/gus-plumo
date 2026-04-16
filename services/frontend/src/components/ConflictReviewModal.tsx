import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, AlertTriangle, Check, X as XIcon, Tag, DollarSign, FileText, ChevronDown, ChevronRight, CreditCard, Users } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { ImportConflict, ConflictResolution, MatchCandidate } from '../types/importConflict'

// Função para gerar chave única para um conflito (já que existing_id pode ser null em múltiplos matches)
const getConflictKey = (conflict: ImportConflict, index: number): string => {
  if (conflict.existing_id !== null) {
    return `id:${conflict.existing_id}`
  }
  // Para múltiplos matches, usa combinação de data + descrição + índice
  return `multi:${conflict.date}:${conflict.description}:${index}`
}

interface ConflictReviewModalProps {
  isOpen: boolean
  onClose: () => void
  conflicts: ImportConflict[]
  onResolve: (resolutions: ConflictResolution[]) => Promise<void>
}

// Estrutura para agrupamento: arquivo -> cartão -> conflitos
interface CardGroup {
  cardNumber: string
  conflicts: ImportConflict[]
}

interface FileGroup {
  fileName: string
  hasCards: boolean  // true se é fatura com cartões
  cards: CardGroup[]  // Subdivisão por cartão (se aplicável)
  conflicts: ImportConflict[]  // Conflitos sem cartão (extrato, benefício)
}

const ConflictReviewModal = ({ isOpen, onClose, conflicts, onResolve }: ConflictReviewModalProps) => {
  // Estado local para resoluções: { conflictKey: { acceptTag: boolean, acceptAmount: boolean } }
  const [resolutions, setResolutions] = useState<Record<string, { acceptTag: boolean; acceptAmount: boolean }>>({})
  // Estado para seleção de matches quando há múltiplos: { conflictKey: selectedMatchId }
  const [selectedMatches, setSelectedMatches] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // Estado para controlar quais grupos estão expandidos (arquivos e cartões)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Mapa de conflito -> índice global (para gerar chave única)
  const conflictIndexMap = useMemo(() => {
    const map = new Map<ImportConflict, number>()
    conflicts.forEach((conflict, index) => {
      map.set(conflict, index)
    })
    return map
  }, [conflicts])

  // Agrupa conflitos por arquivo e, dentro de cada arquivo de fatura, por cartão
  const fileGroups = useMemo(() => {
    const grouped: Record<string, FileGroup> = {}

    conflicts.forEach(conflict => {
      const fileName = conflict.source_file || 'Arquivo não identificado'

      if (!grouped[fileName]) {
        grouped[fileName] = {
          fileName,
          hasCards: false,
          cards: [],
          conflicts: []
        }
      }

      // Se é fatura (credit_card_invoice) e tem card_number, agrupa por cartão
      if (conflict.record_type === 'credit_card_invoice' && conflict.card_number) {
        grouped[fileName].hasCards = true
        const cardKey = conflict.card_number
        let cardGroup = grouped[fileName].cards.find(c => c.cardNumber === cardKey)
        if (!cardGroup) {
          cardGroup = { cardNumber: cardKey, conflicts: [] }
          grouped[fileName].cards.push(cardGroup)
        }
        cardGroup.conflicts.push(conflict)
      } else {
        // Extrato ou benefício - sem subdivisão por cartão
        grouped[fileName].conflicts.push(conflict)
      }
    })

    // Ordena cartões dentro de cada arquivo
    Object.values(grouped).forEach(group => {
      group.cards.sort((a, b) => a.cardNumber.localeCompare(b.cardNumber))
    })

    return Object.values(grouped).sort((a, b) => a.fileName.localeCompare(b.fileName))
  }, [conflicts])

  // Inicializa resoluções e expande todos os grupos por padrão
  useEffect(() => {
    if (conflicts.length > 0) {
      const initialResolutions: Record<string, { acceptTag: boolean; acceptAmount: boolean }> = {}
      const initialSelectedMatches: Record<string, number> = {}

      conflicts.forEach((conflict, index) => {
        const key = getConflictKey(conflict, index)
        initialResolutions[key] = {
          acceptTag: false,
          acceptAmount: false
        }
        // Se tem múltiplos matches, não pré-seleciona nenhum
        // O usuário precisa escolher explicitamente
      })
      setResolutions(initialResolutions)
      setSelectedMatches(initialSelectedMatches)

      // Expande todos os grupos (arquivos e cartões) por padrão
      const allGroups = new Set<string>()
      fileGroups.forEach(group => {
        allGroups.add(`file:${group.fileName}`)
        group.cards.forEach(card => {
          allGroups.add(`card:${group.fileName}:${card.cardNumber}`)
        })
      })
      setExpandedGroups(allGroups)
    }
  }, [conflicts, fileGroups])

  // Toggle de expansão de um grupo (arquivo ou cartão)
  const toggleGroupExpansion = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey)
      } else {
        newSet.add(groupKey)
      }
      return newSet
    })
  }, [])

  // Handler para fechar com confirmação
  const handleCloseRequest = () => {
    setShowCancelConfirm(true)
  }

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false)
    onClose()
  }

  useEscapeKey(handleCloseRequest, isOpen && !showCancelConfirm)

  // Ignorar todas as mudanças de um conflito individual (manter valores originais)
  const handleIgnoreConflict = useCallback((conflictKey: string) => {
    setResolutions(prev => ({
      ...prev,
      [conflictKey]: {
        acceptTag: false,
        acceptAmount: false
      }
    }))
  }, [])

  // Aceitar todas as mudanças de um conflito individual
  const handleAcceptConflict = useCallback((conflictKey: string, conflict: ImportConflict) => {
    setResolutions(prev => ({
      ...prev,
      [conflictKey]: {
        // Para múltiplos matches, aceita a atualização de valor (sempre true)
        acceptTag: !!conflict.tag_conflict,
        acceptAmount: !!conflict.amount_conflict || !!conflict.multiple_matches
      }
    }))
  }, [])

  // Toggle individual para tag
  const handleToggleTag = useCallback((conflictKey: string, accept: boolean) => {
    setResolutions(prev => ({
      ...prev,
      [conflictKey]: {
        ...prev[conflictKey],
        acceptTag: accept
      }
    }))
  }, [])

  // Toggle individual para amount
  const handleToggleAmount = useCallback((conflictKey: string, accept: boolean) => {
    setResolutions(prev => ({
      ...prev,
      [conflictKey]: {
        ...prev[conflictKey],
        acceptAmount: accept
      }
    }))
  }, [])

  // Selecionar um match específico quando há múltiplos
  const handleSelectMatch = useCallback((conflictKey: string, matchId: number) => {
    setSelectedMatches(prev => ({
      ...prev,
      [conflictKey]: matchId
    }))
  }, [])

  const handleAcceptAll = useCallback(() => {
    const newResolutions: Record<string, { acceptTag: boolean; acceptAmount: boolean }> = {}
    conflicts.forEach((conflict, index) => {
      const key = getConflictKey(conflict, index)
      newResolutions[key] = {
        acceptTag: !!conflict.tag_conflict,
        acceptAmount: !!conflict.amount_conflict || !!conflict.multiple_matches
      }
    })
    setResolutions(newResolutions)
  }, [conflicts])

  const handleRejectAll = useCallback(() => {
    const newResolutions: Record<string, { acceptTag: boolean; acceptAmount: boolean }> = {}
    conflicts.forEach((conflict, index) => {
      const key = getConflictKey(conflict, index)
      newResolutions[key] = {
        acceptTag: false,
        acceptAmount: false
      }
    })
    setResolutions(newResolutions)
  }, [conflicts])

  const handleSubmit = async () => {
    // Validação: verifica se há conflitos com múltiplos matches sem seleção
    const unselectedMultipleMatches = conflicts.filter((conflict, index) => {
      if (!conflict.multiple_matches) return false
      const key = getConflictKey(conflict, index)
      const resolution = resolutions[key]
      // Se está aceitando a mudança, precisa ter um match selecionado
      if (resolution?.acceptAmount || resolution?.acceptTag) {
        return !selectedMatches[key]
      }
      return false
    })

    if (unselectedMultipleMatches.length > 0) {
      alert(`Selecione um registro para ${unselectedMultipleMatches.length} conflito(s) com múltiplos matches antes de salvar.`)
      return
    }

    setIsSubmitting(true)
    try {
      const resolvedConflicts: ConflictResolution[] = conflicts.map((conflict, index) => {
        const key = getConflictKey(conflict, index)
        const resolution = resolutions[key]
        const isMultipleMatch = !!conflict.multiple_matches
        const selectedMatchId = selectedMatches[key]

        return {
          // Para múltiplos matches, usa o ID selecionado; caso contrário, usa existing_id
          existing_id: isMultipleMatch ? (selectedMatchId || 0) : (conflict.existing_id || 0),
          record_type: conflict.record_type,
          accept_tag_change: resolution?.acceptTag ?? false,
          accept_amount_change: resolution?.acceptAmount ?? false,
          // Pega subtag_id do topo OU do tag_conflict
          new_subtag_id: conflict.new_subtag_id ?? conflict.tag_conflict?.new_subtag_id,
          // Pega amount do topo OU do amount_conflict OU new_amount para múltiplos matches
          new_amount: conflict.new_amount ?? conflict.amount_conflict?.new_amount,
          // Indica se foi selecionado de múltiplos matches
          selected_from_multiple: isMultipleMatch && !!selectedMatchId
        }
      })
      await onResolve(resolvedConflicts)
      // NÃO chama onClose() aqui pois onResolve já fecha o modal
      // e onClose é a função de descarte (handleDiscardConflicts)
    } catch (error) {
      console.error('Erro ao resolver conflitos:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('pt-BR')
    } catch {
      return dateStr
    }
  }

  // Verifica se todas as mudanças de um conflito estão aceitas
  const isConflictFullyAccepted = useCallback((conflict: ImportConflict, conflictKey: string): boolean => {
    const resolution = resolutions[conflictKey]
    if (!resolution) return false
    // Para múltiplos matches, verificar se acceptAmount está true
    if (conflict.multiple_matches) {
      return resolution.acceptAmount
    }
    const tagAccepted = !conflict.tag_conflict || resolution.acceptTag
    const amountAccepted = !conflict.amount_conflict || resolution.acceptAmount
    return tagAccepted && amountAccepted
  }, [resolutions])

  // Verifica se todas as mudanças de um conflito estão ignoradas
  const isConflictFullyIgnored = useCallback((conflictKey: string): boolean => {
    const resolution = resolutions[conflictKey]
    if (!resolution) return true // Padrão é ignorado
    return !resolution.acceptTag && !resolution.acceptAmount
  }, [resolutions])

  // Renderiza um item de conflito individual - Layout com linhas separadas para cada tipo
  const renderConflictItem = (conflict: ImportConflict, globalIndex: number) => {
    const conflictKey = getConflictKey(conflict, globalIndex)
    const resolution = resolutions[conflictKey] || { acceptTag: false, acceptAmount: false }
    const hasMultipleMatches = !!conflict.multiple_matches && conflict.multiple_matches.length > 0
    const selectedMatchId = selectedMatches[conflictKey]

    // Botões de toggle reutilizáveis
    const renderToggleButtons = (type: 'tag' | 'amount', isAccepted: boolean) => (
      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
        <button
          onClick={() => type === 'tag' ? handleToggleTag(conflictKey, false) : handleToggleAmount(conflictKey, false)}
          title="Ignorar mudança (manter original)"
          className={`px-2 py-1 text-xs font-medium transition-all ${
            !isAccepted
              ? 'text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          style={{ backgroundColor: !isAccepted ? 'var(--crud-cancel)' : undefined }}
        >
          Ignorar
        </button>
        <button
          onClick={() => type === 'tag' ? handleToggleTag(conflictKey, true) : handleToggleAmount(conflictKey, true)}
          title="Aceitar mudança (usar novo valor)"
          className={`px-2 py-1 text-xs font-medium transition-all border-l border-gray-300 dark:border-gray-600 ${
            isAccepted
              ? 'text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          style={{ backgroundColor: isAccepted ? 'var(--status-success)' : undefined }}
        >
          Aceitar
        </button>
      </div>
    )

    return (
      <div
        key={conflictKey}
        className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700"
      >
        {/* Header com descrição e data */}
        <div className="flex items-center gap-2 mb-2">
          {conflict.existing_id && (
            <span className="text-xs text-gray-400 dark:text-gray-500">#{conflict.existing_id}</span>
          )}
          {hasMultipleMatches && (
            <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded flex items-center gap-1">
              <Users size={10} />
              {conflict.multiple_matches!.length} registros
            </span>
          )}
          <p className="font-medium text-sm text-gray-900 dark:text-white truncate flex-1">
            {conflict.description}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(conflict.date)}
            {conflict.year_month && ` • ${conflict.year_month}`}
          </p>
        </div>

        {/* Linhas de conflito separadas */}
        <div className="space-y-2">
          {/* Linha Tag Conflict */}
          {conflict.tag_conflict && (
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
                <Tag size={12} className="text-color-primary flex-shrink-0" />
                <span className="text-gray-500 dark:text-gray-400 line-through truncate">
                  {conflict.tag_conflict.original_tag_name || 'N/A'}/{conflict.tag_conflict.original_subtag_name || 'N/A'}
                </span>
                <span className="text-gray-400 flex-shrink-0">→</span>
                <span className="text-gray-900 dark:text-white font-medium truncate">
                  {conflict.tag_conflict.new_tag_name || 'N/A'}/{conflict.tag_conflict.new_subtag_name || 'N/A'}
                </span>
              </div>
              {renderToggleButtons('tag', resolution.acceptTag)}
            </div>
          )}

          {/* Linha Amount Conflict */}
          {conflict.amount_conflict && (
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 text-xs">
                <DollarSign size={12} className="text-color-primary" />
                <span className={`line-through font-mono ${
                  conflict.amount_conflict.original_amount >= 0
                    ? 'text-green-500 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400'
                }`}>
                  {formatCurrency(conflict.amount_conflict.original_amount)}
                </span>
                <span className="text-gray-400">→</span>
                <span className={`font-medium font-mono ${
                  conflict.amount_conflict.new_amount >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatCurrency(conflict.amount_conflict.new_amount)}
                </span>
              </div>
              {renderToggleButtons('amount', resolution.acceptAmount)}
            </div>
          )}

          {/* Múltiplos matches - linha com novo valor e botões */}
          {hasMultipleMatches && conflict.new_amount !== undefined && (
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-300 dark:border-yellow-700">
              <div className="flex items-center gap-1.5 text-xs">
                <Users size={12} className="text-yellow-600 dark:text-yellow-400" />
                <span className="text-gray-600 dark:text-gray-400">Atualizar valor para:</span>
                <span className={`font-medium font-mono ${
                  conflict.new_amount >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatCurrency(conflict.new_amount)}
                </span>
              </div>
              {renderToggleButtons('amount', resolution.acceptAmount)}
            </div>
          )}
        </div>

        {/* Seleção de registro para múltiplos matches - aparece quando aceitar qualquer mudança */}
        {hasMultipleMatches && (resolution.acceptTag || resolution.acceptAmount) && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Selecione qual registro atualizar:
            </p>
            <div className="space-y-1.5">
              {conflict.multiple_matches!.map((match) => (
                <label
                  key={match.id}
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                    selectedMatchId === match.id
                      ? 'bg-color-primary-light border border-color-primary'
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name={`match-${conflictKey}`}
                    checked={selectedMatchId === match.id}
                    onChange={() => handleSelectMatch(conflictKey, match.id)}
                    className="w-4 h-4 text-color-primary"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">#{match.id}</span>
                  <span className={`text-sm font-mono ${
                    match.amount >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {formatCurrency(match.amount)}
                  </span>
                  {/* Parcelas (para faturas de cartão) */}
                  {match.current_installment && match.total_installments && (
                    <span className="text-xs font-medium text-color-primary bg-color-primary-light px-1.5 py-0.5 rounded">
                      {match.current_installment}/{match.total_installments}
                    </span>
                  )}
                  {match.subtag_name && (
                    <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <Tag size={10} />
                      {match.tag_name} / {match.subtag_name}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Conflitos Detectados
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {conflicts.length} registro(s) com diferenças em tag/subtag ou valor
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseRequest}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content - continuação via str-replace-editor */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Botões de ação em massa */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={handleRejectAll}
              title="Ignorar todas as mudanças"
              className="px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 text-white hover:opacity-90"
              style={{ backgroundColor: 'var(--crud-cancel)' }}
            >
              <XIcon className="w-4 h-4" />
              Ignorar Todos
            </button>
            <button
              onClick={handleAcceptAll}
              title="Aceitar todas as mudanças"
              className="px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 text-white hover:opacity-90"
              style={{ backgroundColor: 'var(--status-success)' }}
            >
              <Check className="w-4 h-4" />
              Aceitar Todos
            </button>
          </div>

          {/* Lista de conflitos agrupados por arquivo (e cartão para faturas) */}
          <div className="space-y-4">
            {fileGroups.map((fileGroup) => {
              const fileKey = `file:${fileGroup.fileName}`
              const totalConflicts = fileGroup.hasCards
                ? fileGroup.cards.reduce((sum, c) => sum + c.conflicts.length, 0)
                : fileGroup.conflicts.length

              return (
                <div key={fileGroup.fileName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  {/* Header do grupo (arquivo) */}
                  <button
                    onClick={() => toggleGroupExpansion(fileKey)}
                    className="w-full flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-900/70 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {expandedGroups.has(fileKey) ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                      <FileText className="w-4 h-4 text-color-primary" />
                      <span className="font-medium text-gray-900 dark:text-white text-sm truncate max-w-md">
                        {fileGroup.fileName}
                      </span>
                    </div>
                    <span className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">
                      {totalConflicts} conflito{totalConflicts > 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Conteúdo do arquivo (colapsável) */}
                  {expandedGroups.has(fileKey) && (
                    <div className="p-3">
                      {/* Se tem cartões (fatura), mostra subdivisão */}
                      {fileGroup.hasCards ? (
                        <div className="space-y-3">
                          {fileGroup.cards.map((cardGroup) => {
                            const cardKey = `card:${fileGroup.fileName}:${cardGroup.cardNumber}`
                            return (
                              <div key={cardGroup.cardNumber} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                                {/* Header do cartão */}
                                <button
                                  onClick={() => toggleGroupExpansion(cardKey)}
                                  className="w-full flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {expandedGroups.has(cardKey) ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                                    )}
                                    <CreditCard className="w-4 h-4 text-purple-500" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                      Cartão ****{cardGroup.cardNumber}
                                    </span>
                                  </div>
                                  <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-full">
                                    {cardGroup.conflicts.length} conflito{cardGroup.conflicts.length > 1 ? 's' : ''}
                                  </span>
                                </button>

                                {/* Conflitos do cartão */}
                                {expandedGroups.has(cardKey) && (
                                  <div className="p-2.5 space-y-2.5">
                                    {cardGroup.conflicts.map((conflict) => renderConflictItem(conflict, conflictIndexMap.get(conflict) ?? 0))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        /* Sem cartões - mostra conflitos diretamente */
                        <div className="space-y-3">
                          {fileGroup.conflicts.map((conflict) => renderConflictItem(conflict, conflictIndexMap.get(conflict) ?? 0))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={handleCloseRequest}
            className="px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
            style={{ background: 'var(--crud-cancel)' }}
          >
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting}
            className="px-6 py-2 bg-color-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? 'Salvando...' : 'Aplicar Resoluções'}
          </button>
        </div>
      </div>

      {/* Modal de Confirmação de Cancelamento */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Descartar Alterações?
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Ao cancelar, <strong>todos os {conflicts.length} registro(s) com conflitos serão ignorados</strong>.
              Os valores atuais do banco serão mantidos e as novas mudanças serão descartadas.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={handleConfirmCancel}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Sim, Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConflictReviewModal

