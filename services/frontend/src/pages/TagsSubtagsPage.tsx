import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListCreateButton,
  CadastroRowMutations,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageSearchField,
  CadastroListPageShell,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableRowHoverCls,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import { usePageWriteAllowed, WriteGate } from '../contexts/PageMutationContext'
import BulkSelectCheckbox, { type HeaderCheckState } from '../components/BulkSelectCheckbox'
import { ListPageExpandRow, ListPageTable } from '../components/ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
  cadastroFieldCls,
  cadastroOptionLabelCls,
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import IconPicker from '../components/IconPicker'
import Toast from '../components/Toast'
import {
  Plus, Edit2, Trash2, Tag, ChevronDown, ChevronRight, ArrowDownCircle, ArrowUpCircle, ArrowUp, X,
  ChevronsDown, ChevronsUp, GripVertical, Save,
} from 'lucide-react'
import { getIconComponent } from '../utils/iconMapper'
import { selectionHeaderState } from '../utils/listTableSelection'
import { useConfirm } from '../hooks/useConfirm'
import { useExportRunner } from '../hooks/useExportRunner'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { exportTagsSubtagsToExcel } from '../utils/exportCadastroExcel'

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

const TAG_TABLE_COL_SPAN = 7

const SUBTAG_DRAG_MIME = 'application/x-plumo-subtag-ids'

type SubtagDragMeta = {
  ids: number[]
}

function subtagTagDropZoneKey(tagId: number) {
  return `tag:${tagId}`
}

function parseSubtagDragIds(raw: string): number[] {
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id))
}

function SubtagAreaCard({
  kind,
  rows,
  tagId,
  selectedSubtagIds,
  onToggleSubtag,
  onToggleAllInColumn,
  columnSelectState,
  onCreate,
  onEdit,
  onDelete,
  dropZoneKey,
  isDropTarget,
  onDragOverZone,
  onDragLeaveZone,
  onDropOnZone,
  pendingMovedSubtagIds,
  dragMeta,
  onDragStartSubtag,
}: {
  kind: 'despesa' | 'receita'
  rows: SubtagItem[]
  tagId: number
  selectedSubtagIds: Set<number>
  onToggleSubtag: (subtagId: number) => void
  onToggleAllInColumn: (tagId: number, kind: 'despesa' | 'receita') => void
  columnSelectState: HeaderCheckState
  onCreate: (tagId: number, type: 'despesa' | 'receita') => void
  onEdit: (subtag: SubtagItem) => void
  onDelete: (id: number) => void
  dropZoneKey: string
  isDropTarget: boolean
  onDragOverZone: (key: string) => void
  onDragLeaveZone: (key: string) => void
  onDropOnZone: (subtagIds: number[], targetTagId: number) => void
  pendingMovedSubtagIds: Set<number>
  dragMeta: SubtagDragMeta | null
  onDragStartSubtag: (e: React.DragEvent, subtagId: number) => void
}) {
  const title = kind === 'despesa' ? 'Despesas' : 'Receitas'
  const toneCls =
    kind === 'despesa' ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'
  const Icon = kind === 'despesa' ? ArrowDownCircle : ArrowUpCircle

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors dark:border-gray-700 dark:bg-gray-800 ${
        isDropTarget
          ? 'border-[var(--color-1)] ring-2 ring-[color-mix(in_srgb,var(--color-1)_35%,transparent)]'
          : 'hover:border-[color-mix(in_srgb,var(--color-1)_35%,#d1d5db)] dark:hover:border-[color-mix(in_srgb,var(--color-1)_40%,#4b5563)]'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverZone(dropZoneKey)
      }}
      onDragLeave={() => onDragLeaveZone(dropZoneKey)}
      onDrop={(e) => {
        e.preventDefault()
        const raw = e.dataTransfer.getData(SUBTAG_DRAG_MIME)
        const subtagIds = parseSubtagDragIds(raw)
        if (subtagIds.length === 0) return
        onDropOnZone(subtagIds, tagId)
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {rows.length > 0 && (
            <BulkSelectCheckbox
              state={columnSelectState}
              onClick={() => onToggleAllInColumn(tagId, kind)}
              title={`Selecionar subtags de ${kind}`}
            />
          )}
          <h4 className={`flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${toneCls}`}>
            <Icon size={14} className="shrink-0" />
            <span className="truncate">{title}</span>
            <span className="font-normal normal-case text-gray-500 dark:text-gray-400">({rows.length})</span>
          </h4>
        </div>
        <CadastroRowMutations>
          <button
            type="button"
            onClick={() => onCreate(tagId, kind)}
            className={cadastroRowIconBtnCls}
            title={`Nova subtag de ${kind}`}
          >
            <Plus size={14} />
          </button>
        </CadastroRowMutations>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          {dragMeta ? 'Solte aqui para mover' : 'Nenhuma subtag'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((subtag) => {
            const SubIcon = getIconComponent(subtag.icon || 'Tags')
            const isPendingMove = pendingMovedSubtagIds.has(subtag.id)
            return (
              <li
                key={subtag.id}
                className={`group flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 ${
                  selectedSubtagIds.has(subtag.id) ? 'bg-[color-mix(in_srgb,var(--color-1)_6%,transparent)]' : ''
                } ${isPendingMove ? 'bg-amber-50/80 dark:bg-amber-900/15' : ''} ${
                  dragMeta?.ids.includes(subtag.id) ? 'opacity-50' : ''
                }`}
                title={subtag.description || undefined}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    onDragStartSubtag(e, subtag.id)
                  }}
                  className="cursor-grab text-gray-400 active:cursor-grabbing dark:text-gray-500"
                  title={
                    selectedSubtagIds.has(subtag.id) && selectedSubtagIds.size > 1
                      ? 'Arrastar subtags selecionadas (mesmo tipo)'
                      : 'Arrastar para outra tag'
                  }
                  aria-hidden
                >
                  <GripVertical size={14} />
                </span>
                <span onMouseDown={(e) => e.stopPropagation()}>
                  <BulkSelectCheckbox
                    checked={selectedSubtagIds.has(subtag.id)}
                    onClick={() => onToggleSubtag(subtag.id)}
                  />
                </span>
                <SubIcon size={14} className={`shrink-0 ${toneCls}`} />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${
                    subtag.active
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {subtag.name}
                </span>
                {isPendingMove ? (
                  <Badge variant="statusCompact" tone="warning" label="Movida" />
                ) : null}
                <CadastroRowMutations>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onEdit(subtag)}
                      className={cadastroRowIconBtnCls}
                      title="Editar"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onDelete(subtag.id)}
                      className={cadastroRowIconDangerCls}
                      title="Excluir"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </CadastroRowMutations>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const TagsSubtagsPage = () => {
  const canWrite = usePageWriteAllowed()
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

  const exportRunner = useExportRunner((message) => showToast(message, 'error'))

  // Estados de expansão
  const [expandedTags, setExpandedTags] = useState<Set<number>>(new Set())
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(() => new Set())
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [pendingSubtagMoves, setPendingSubtagMoves] = useState<Record<number, number>>({})
  const [dragOverDropKey, setDragOverDropKey] = useState<string | null>(null)
  const [dragMeta, setDragMeta] = useState<SubtagDragMeta | null>(null)
  const [savingSubtagMoves, setSavingSubtagMoves] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  
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

  const scrollToTop = useCallback(() => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      setShowBackToTop(container.scrollTop > 300)
    }

    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isLoading, hierarchicalData.length, searchTerm])

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
  const handleCreateSubtag = (tagId: number, type: 'despesa' | 'receita' = 'despesa') => {
    setEditingSubtag(null)
    setContextTagId(tagId)
    setSubtagFormData({ tag_id: tagId, name: '', description: '', type, icon: 'Tags' })
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

  const serverSubtagsById = useMemo(() => {
    const map = new Map<number, SubtagItem>()
    for (const row of hierarchicalData) {
      for (const st of row.subtags) map.set(st.id, st)
    }
    return map
  }, [hierarchicalData])

  const displayHierarchicalData = useMemo((): HierarchicalData[] => {
    if (Object.keys(pendingSubtagMoves).length === 0) return hierarchicalData

    const remapped: SubtagItem[] = []
    for (const row of hierarchicalData) {
      for (const st of row.subtags) {
        const tagId = pendingSubtagMoves[st.id] ?? st.tag_id
        const tagName = hierarchicalData.find((r) => r.tag.id === tagId)?.tag.name ?? st.tag_name
        remapped.push({ ...st, tag_id: tagId, tag_name: tagName })
      }
    }

    return hierarchicalData.map((row) => {
      const tagSubtags = remapped
        .filter((st) => st.tag_id === row.tag.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      return { tag: row.tag, subtags: tagSubtags, subtagsCount: tagSubtags.length }
    })
  }, [hierarchicalData, pendingSubtagMoves])

  const pendingMovedSubtagIds = useMemo(() => {
    const set = new Set<number>()
    for (const [idStr, tagId] of Object.entries(pendingSubtagMoves)) {
      const id = Number(idStr)
      const original = serverSubtagsById.get(id)?.tag_id
      if (original != null && tagId !== original) set.add(id)
    }
    return set
  }, [pendingSubtagMoves, serverSubtagsById])

  const pendingMoveCount = pendingMovedSubtagIds.size

  const handleSubtagDragStart = useCallback(
    (e: React.DragEvent, subtagId: number) => {
      const ids =
        selectedSubtagIds.has(subtagId) && selectedSubtagIds.size > 1
          ? [...selectedSubtagIds]
          : [subtagId]
      e.dataTransfer.setData(SUBTAG_DRAG_MIME, ids.join(','))
      e.dataTransfer.effectAllowed = 'move'
      setDragMeta({ ids })
    },
    [selectedSubtagIds],
  )

  const applySubtagMovesToTag = useCallback(
    (subtagIds: number[], targetTagId: number) => {
      let moved = 0
      for (const subtagId of subtagIds) {
        const subtag = serverSubtagsById.get(subtagId)
        if (!subtag) continue
        const originalTagId = subtag.tag_id
        setPendingSubtagMoves((prev) => {
          const next = { ...prev }
          if (targetTagId === originalTagId) delete next[subtagId]
          else next[subtagId] = targetTagId
          return next
        })
        moved += 1
      }
      if (moved === 0) {
        showToast('Nenhuma subtag válida para mover.', 'warning')
        return
      }
      setExpandedTags((prev) => new Set(prev).add(targetTagId))
      setDragOverDropKey(null)
      setDragMeta(null)
    },
    [serverSubtagsById],
  )

  const discardSubtagMoves = useCallback(() => {
    setPendingSubtagMoves({})
    setDragOverDropKey(null)
    setDragMeta(null)
  }, [])

  const handleSaveSubtagMoves = async () => {
    const moves = [...pendingMovedSubtagIds].map((id) => ({
      id,
      tag_id: pendingSubtagMoves[id]!,
    }))
    if (moves.length === 0) return

    setSavingSubtagMoves(true)
    try {
      await Promise.all(
        moves.map(({ id, tag_id }) => axios.put(`/api/expenses/subtags/${id}`, { tag_id })),
      )
      setPendingSubtagMoves({})
      await loadAllData()
      showToast(
        moves.length === 1 ? 'Subtag movida com sucesso.' : `${moves.length} subtags movidas com sucesso.`,
        'success',
      )
    } catch (error: unknown) {
      console.error('Erro ao salvar movimentação de subtags:', error)
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(typeof detail === 'string' ? detail : 'Não foi possível salvar as alterações.', 'error')
    } finally {
      setSavingSubtagMoves(false)
    }
  }

  useEffect(() => {
    const endDrag = () => {
      setDragMeta(null)
      setDragOverDropKey(null)
    }
    window.addEventListener('dragend', endDrag)
    return () => window.removeEventListener('dragend', endDrag)
  }, [])

  const handleTagRowDragOver = useCallback(
    (e: React.DragEvent, tagId: number) => {
      if (!dragMeta?.ids.length) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverDropKey(subtagTagDropZoneKey(tagId))
    },
    [dragMeta],
  )

  const handleTagRowDrop = useCallback(
    (e: React.DragEvent, tagId: number) => {
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData(SUBTAG_DRAG_MIME)
      const subtagIds = parseSubtagDragIds(raw)
      if (subtagIds.length === 0) return
      applySubtagMovesToTag(subtagIds, tagId)
    },
    [applySubtagMovesToTag],
  )

  // Filtro de busca
  const filteredData = displayHierarchicalData.filter((item) => {
    const tagMatch = item.tag.name.toLowerCase().includes(searchTerm.toLowerCase())
    const subtagMatch = item.subtags.some((st) =>
      st.name.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    return tagMatch || subtagMatch
  })

  const expandAllTags = useCallback(() => {
    setExpandedTags(new Set(filteredData.map((item) => item.tag.id)))
  }, [filteredData])

  const collapseAllTags = useCallback(() => {
    setExpandedTags(new Set())
  }, [])

  const allVisibleTagsExpanded = useMemo(
    () =>
      filteredData.length > 0 &&
      filteredData.every((item) => expandedTags.has(item.tag.id)),
    [filteredData, expandedTags],
  )

  const toggleExpandAllTags = useCallback(() => {
    if (allVisibleTagsExpanded) collapseAllTags()
    else expandAllTags()
  }, [allVisibleTagsExpanded, collapseAllTags, expandAllTags])

  const visibleTagIds = useMemo(() => filteredData.map((item) => item.tag.id), [filteredData])
  const visibleSubtagIds = useMemo(
    () => filteredData.flatMap((item) => item.subtags.map((st) => st.id)),
    [filteredData],
  )
  const visibleBulkKeys = useMemo(
    () => [...visibleTagIds, ...visibleSubtagIds],
    [visibleTagIds, visibleSubtagIds],
  )

  const globalHeaderState = useMemo((): HeaderCheckState => {
    let selectedCount = 0
    for (const tagId of visibleTagIds) {
      if (selectedTagIds.has(tagId)) selectedCount += 1
    }
    for (const subtagId of visibleSubtagIds) {
      if (selectedSubtagIds.has(subtagId)) selectedCount += 1
    }
    if (selectedCount === 0) return 'none'
    if (selectedCount === visibleBulkKeys.length) return 'all'
    return 'partial'
  }, [visibleTagIds, visibleSubtagIds, visibleBulkKeys.length, selectedTagIds, selectedSubtagIds])

  const bulkSelectionCount = useMemo(() => {
    let count = selectedTagIds.size
    for (const item of hierarchicalData) {
      if (selectedTagIds.has(item.tag.id)) continue
      for (const st of item.subtags) {
        if (selectedSubtagIds.has(st.id)) count += 1
      }
    }
    return count
  }, [hierarchicalData, selectedTagIds, selectedSubtagIds])

  const toggleGlobalSelection = useCallback(() => {
    const anySelected =
      visibleTagIds.some((id) => selectedTagIds.has(id)) ||
      visibleSubtagIds.some((id) => selectedSubtagIds.has(id))
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (anySelected) visibleTagIds.forEach((id) => next.delete(id))
      else visibleTagIds.forEach((id) => next.add(id))
      return next
    })
    setSelectedSubtagIds((prev) => {
      const next = new Set(prev)
      if (anySelected) visibleSubtagIds.forEach((id) => next.delete(id))
      else visibleSubtagIds.forEach((id) => next.add(id))
      return next
    })
  }, [visibleTagIds, visibleSubtagIds, selectedTagIds, selectedSubtagIds])

  const toggleTagSelection = useCallback((tagId: number) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const toggleSubtagSelection = useCallback((subtagId: number) => {
    setSelectedSubtagIds((prev) => {
      const next = new Set(prev)
      if (next.has(subtagId)) next.delete(subtagId)
      else next.add(subtagId)
      return next
    })
  }, [])

  const toggleAllSubtagsForTag = useCallback(
    (tagId: number) => {
      const item = hierarchicalData.find((row) => row.tag.id === tagId)
      if (!item) return
      const ids = item.subtags.map((st) => st.id)
      const state = selectionHeaderState(ids, selectedSubtagIds)
      setSelectedSubtagIds((prev) => {
        const next = new Set(prev)
        if (state === 'all') ids.forEach((id) => next.delete(id))
        else ids.forEach((id) => next.add(id))
        return next
      })
    },
    [hierarchicalData, selectedSubtagIds],
  )

  const toggleSubtagsInColumn = useCallback(
    (tagId: number, kind: 'despesa' | 'receita') => {
      const item = hierarchicalData.find((row) => row.tag.id === tagId)
      if (!item) return
      const ids = item.subtags.filter((st) => st.type === kind).map((st) => st.id)
      const state = selectionHeaderState(ids, selectedSubtagIds)
      setSelectedSubtagIds((prev) => {
        const next = new Set(prev)
        if (state === 'all') ids.forEach((id) => next.delete(id))
        else ids.forEach((id) => next.add(id))
        return next
      })
    },
    [hierarchicalData, selectedSubtagIds],
  )

  const clearBulkSelection = useCallback(() => {
    setSelectedTagIds(new Set())
    setSelectedSubtagIds(new Set())
  }, [])

  const handleBulkDelete = async () => {
    const tagIds = [...selectedTagIds]
    const subtagIds = [...selectedSubtagIds].filter((subtagId) => {
      const row = hierarchicalData.find((item) => item.subtags.some((st) => st.id === subtagId))
      return row ? !selectedTagIds.has(row.tag.id) : true
    })
    if (tagIds.length === 0 && subtagIds.length === 0) return

    const parts: string[] = []
    if (tagIds.length > 0) {
      parts.push(`${tagIds.length} tag${tagIds.length === 1 ? '' : 's'} (e subtags vinculadas)`)
    }
    if (subtagIds.length > 0) {
      parts.push(`${subtagIds.length} subtag${subtagIds.length === 1 ? '' : 's'}`)
    }

    showConfirm(
      'Excluir seleção',
      `Excluir ${parts.join(' e ')}?\n\nRegistros associados serão migrados para "Pendente" quando aplicável.`,
      async () => {
        setBulkDeleting(true)
        try {
          const { data } = await axios.post<{ deleted: number; skipped: number }>(
            '/api/expenses/tags/bulk-delete-force',
            { tag_ids: tagIds, subtag_ids: subtagIds },
          )
          clearBulkSelection()
          await loadAllData()
          const msg =
            data.skipped > 0
              ? `${data.deleted} item(ns) excluído(s); ${data.skipped} ignorado(s).`
              : 'Seleção excluída com sucesso.'
          showToast(msg, data.deleted > 0 ? 'success' : 'warning')
        } catch (error: unknown) {
          console.error('Erro na exclusão em massa:', error)
          const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          showToast(typeof detail === 'string' ? detail : 'Não foi possível excluir a seleção.', 'error')
        } finally {
          setBulkDeleting(false)
        }
      },
      'Excluir',
      'Cancelar',
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Tag className="w-8 h-8" />}
              title="Tags e Subtags"
              subtitle="Gerencie suas tags e subtags de categorização"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    exportDisabled: hierarchicalData.length === 0,
                    onExportExcel: () => {
                      const tags = hierarchicalData.map((h) => h.tag)
                      const subtags = hierarchicalData.flatMap((h) => h.subtags)
                      void exportRunner.run('Gerando Excel…', () => exportTagsSubtagsToExcel(tags, subtags))
                    },
                  }}
                >
                  <CadastroListCreateButton label="Nova Tag" onClick={handleCreateTag} />
                </CadastroListHeaderActions>
              }
            />
          }
          tabs={
            hierarchicalData.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleExpandAllTags}
                  disabled={filteredData.length === 0}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  title={
                    allVisibleTagsExpanded
                      ? 'Recolher subtags de todas as tags visíveis'
                      : 'Expandir subtags de todas as tags visíveis'
                  }
                >
                  {allVisibleTagsExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
                  {allVisibleTagsExpanded ? 'Recolher todas' : 'Expandir todas'}
                </button>
                <div className="min-w-0 flex-1">
                  <CadastroListPageSearchField
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder="Buscar tags ou subtags…"
                  />
                </div>
              </div>
            ) : undefined
          }
        >
          {isLoading ? (
            <CadastroListPageLoading label="Carregando tags…" />
          ) : hierarchicalData.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Tag size={32} className="text-gray-400" />}
              title="Nenhuma tag cadastrada"
              description="Comece criando sua primeira tag de categorização"
            />
          ) : filteredData.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Tag size={32} className="text-gray-400" />}
              title="Nenhum resultado encontrado"
              description="Tente outro termo de busca."
            />
          ) : (
            <div className={pendingMoveCount > 0 || bulkSelectionCount > 0 || showBackToTop ? 'pb-20' : ''}>
            <ListPageTable
              leadingMode="bulk"
              colsRest={
                <>
                  <ListTableSpacerCol />
                  <col />
                  <col />
                  <col style={{ width: 112, minWidth: 100 }} />
                  <col style={{ width: 96, minWidth: 96 }} />
                </>
              }
              head={
                <tr>
                  <ListTableCheckboxHeader state={globalHeaderState} onToggle={toggleGlobalSelection} />
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Tag" />
                  <ListTableStaticHeader label="Descrição" />
                  <ListTableStaticHeader label="Subtags" />
                  <ListTableStaticHeader label="Ações" />
                </tr>
              }
            >
              {filteredData.map((item, index) => {
                const IconComponent = getIconComponent(item.tag.icon || 'Tag')
                const isExpanded = expandedTags.has(item.tag.id)
                const despesas = item.subtags.filter((st) => st.type === 'despesa')
                const receitas = item.subtags.filter((st) => st.type === 'receita')
                const tagSelected = selectedTagIds.has(item.tag.id)
                const tagSubtagIds = item.subtags.map((st) => st.id)
                const tagSubtagsState = selectionHeaderState(tagSubtagIds, selectedSubtagIds)
                const rowSelected =
                  tagSelected || tagSubtagsState !== 'none'

                return (
                  <Fragment key={item.tag.id}>
                    <tr
                      className={`${listPageTableRowHoverCls} ${
                        isExpanded ? 'bg-[color-mix(in_srgb,var(--color-1)_4%,transparent)] [&>td]:border-b-0' : ''
                      } ${rowSelected && !isExpanded ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]' : ''} ${
                        dragOverDropKey === subtagTagDropZoneKey(item.tag.id)
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_10%,transparent)] ring-2 ring-inset ring-[var(--color-1)]'
                          : ''
                      }`}
                      onDragOver={(e) => handleTagRowDragOver(e, item.tag.id)}
                      onDragLeave={() =>
                        setDragOverDropKey((prev) =>
                          prev === subtagTagDropZoneKey(item.tag.id) ? null : prev,
                        )
                      }
                      onDrop={(e) => handleTagRowDrop(e, item.tag.id)}
                    >
                      <ListTableCheckboxCell
                        checked={tagSelected}
                        onToggle={() => toggleTagSelection(item.tag.id)}
                      />
                      <ListTableIndexCell index={index + 1} />
                      <ListTableSpacerCell />
                      <td className="cursor-pointer px-3 py-3" onClick={() => toggleTag(item.tag.id)}>
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTag(item.tag.id)
                            }}
                            className={cadastroRowIconBtnCls}
                            title={isExpanded ? 'Recolher' : 'Expandir subtags'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <IconComponent size={16} className="shrink-0" style={{ color: 'var(--color-1)' }} />
                          <span
                            className={`truncate text-sm font-semibold ${
                              isExpanded
                                ? 'text-[var(--color-1)]'
                                : item.tag.active
                                  ? 'text-gray-800 dark:text-gray-100'
                                  : 'text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {item.tag.name}
                          </span>
                        </div>
                      </td>
                      <td
                        className="cursor-pointer truncate px-3 py-3 text-sm text-gray-600 dark:text-gray-300"
                        onClick={() => toggleTag(item.tag.id)}
                        title={item.tag.description || undefined}
                      >
                        {item.tag.description || '—'}
                      </td>
                      <td className="cursor-pointer px-3 py-3" onClick={() => toggleTag(item.tag.id)}>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            variant={badgeVariantForColumnRole('classificationPrimary')}
                            tone="danger"
                            label={String(despesas.length)}
                          />
                          <Badge
                            variant={badgeVariantForColumnRole('classificationSecondary')}
                            tone="success"
                            label={String(receitas.length)}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <CadastroRowMutations>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleEditTag(item.tag)}
                              className={cadastroRowIconBtnCls}
                              title="Editar tag"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTag(item.tag.id)}
                              className={cadastroRowIconDangerCls}
                              title="Excluir tag"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </CadastroRowMutations>
                      </td>
                    </tr>
                    {isExpanded && (
                      <ListPageExpandRow colSpan={TAG_TABLE_COL_SPAN}>
                        {item.subtags.length > 0 && (
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <BulkSelectCheckbox
                                state={tagSubtagsState}
                                onClick={() => toggleAllSubtagsForTag(item.tag.id)}
                              />
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                Selecionar todas as subtags desta tag
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Arraste subtags e solte na linha da tag de destino
                            </span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <SubtagAreaCard
                            kind="despesa"
                            rows={despesas}
                            tagId={item.tag.id}
                            selectedSubtagIds={selectedSubtagIds}
                            onToggleSubtag={toggleSubtagSelection}
                            onToggleAllInColumn={toggleSubtagsInColumn}
                            columnSelectState={selectionHeaderState(
                              despesas.map((st) => st.id),
                              selectedSubtagIds,
                            )}
                            onCreate={handleCreateSubtag}
                            onEdit={handleEditSubtag}
                            onDelete={handleDeleteSubtag}
                            dropZoneKey={subtagTagDropZoneKey(item.tag.id)}
                            isDropTarget={dragOverDropKey === subtagTagDropZoneKey(item.tag.id)}
                            onDragOverZone={setDragOverDropKey}
                            onDragLeaveZone={(key) =>
                              setDragOverDropKey((prev) => (prev === key ? null : prev))
                            }
                            onDropOnZone={applySubtagMovesToTag}
                            pendingMovedSubtagIds={pendingMovedSubtagIds}
                            dragMeta={dragMeta}
                            onDragStartSubtag={handleSubtagDragStart}
                          />
                          <SubtagAreaCard
                            kind="receita"
                            rows={receitas}
                            tagId={item.tag.id}
                            selectedSubtagIds={selectedSubtagIds}
                            onToggleSubtag={toggleSubtagSelection}
                            onToggleAllInColumn={toggleSubtagsInColumn}
                            columnSelectState={selectionHeaderState(
                              receitas.map((st) => st.id),
                              selectedSubtagIds,
                            )}
                            onCreate={handleCreateSubtag}
                            onEdit={handleEditSubtag}
                            onDelete={handleDeleteSubtag}
                            dropZoneKey={subtagTagDropZoneKey(item.tag.id)}
                            isDropTarget={dragOverDropKey === subtagTagDropZoneKey(item.tag.id)}
                            onDragOverZone={setDragOverDropKey}
                            onDragLeaveZone={(key) =>
                              setDragOverDropKey((prev) => (prev === key ? null : prev))
                            }
                            onDropOnZone={applySubtagMovesToTag}
                            pendingMovedSubtagIds={pendingMovedSubtagIds}
                            dragMeta={dragMeta}
                            onDragStartSubtag={handleSubtagDragStart}
                          />
                        </div>
                      </ListPageExpandRow>
                    )}
                  </Fragment>
                )
              })}
            </ListPageTable>
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {canWrite && pendingMoveCount > 0 && (
        <FloatingFooterBar>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-medium text-color-primary">
                {pendingMoveCount}{' '}
                {pendingMoveCount === 1 ? 'subtag movida (não salva)' : 'subtags movidas (não salvas)'}
              </span>
              <button
                type="button"
                onClick={discardSubtagMoves}
                disabled={savingSubtagMoves}
                className="flex items-center gap-1 text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                style={{ color: 'var(--color-1)' }}
              >
                <X size={14} />
                Descartar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveSubtagMoves()}
                disabled={savingSubtagMoves}
                className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--crud-create)' }}
              >
                <Save size={16} />
                {savingSubtagMoves ? 'Salvando…' : 'Salvar'}
              </button>
              {showBackToTop ? (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              ) : null}
            </div>
          </div>
        </FloatingFooterBar>
      )}

      {canWrite && bulkSelectionCount > 0 && pendingMoveCount === 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {bulkSelectionCount}{' '}
                {bulkSelectionCount === 1 ? 'item selecionado' : 'itens selecionados'}
              </span>
              <button
                type="button"
                onClick={clearBulkSelection}
                disabled={bulkDeleting}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <WriteGate>
                <button
                  type="button"
                  onClick={() => void handleBulkDelete()}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--crud-delete)' }}
                >
                  <Trash2 size={14} />
                  {bulkDeleting ? 'Excluindo…' : 'Excluir'}
                </button>
              </WriteGate>
              {showBackToTop && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              )}
            </div>
          </div>
        </FloatingFooterBar>
      )}

      {showBackToTop && bulkSelectionCount === 0 && pendingMoveCount === 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={scrollToTop}
              className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}

      {/* Modal de Tag */}
      {showTagModal && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={!!editingTag}
            title={editingTag ? 'Editar Tag' : 'Nova Tag'}
            subtitle="Categoria usada para classificar lançamentos"
            onClose={() => setShowTagModal(false)}
            icon={<Tag size={18} />}
          />
          <form onSubmit={handleSubmitTag} className="flex min-h-0 flex-1 flex-col" id="tag-form">
            <CadastroModalBody>
              <CadastroFormSection title="Identificação" icon={<Tag size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                      <input
                        type="text"
                        required
                        value={tagFormData.name}
                        onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Alimentação"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                      <textarea
                        value={tagFormData.description}
                        onChange={(e) => setTagFormData({ ...tagFormData, description: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Descrição opcional"
                        rows={3}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <IconPicker
                      value={tagFormData.icon}
                      onChange={(icon) => setTagFormData({ ...tagFormData, icon })}
                      availableIcons={availableIcons}
                      iconNamesPt={iconNamesPt}
                    />
                  </CadastroModalFieldsRow>
                  {!editingTag ? (
                    <CadastroModalFieldsRow>
                      <label className={cadastroOptionLabelCls}>
                        <input
                          type="checkbox"
                          id="createOutroSubtags"
                          checked={tagFormData.createOutroSubtags}
                          onChange={(e) => setTagFormData({ ...tagFormData, createOutroSubtags: e.target.checked })}
                          className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                        />
                        Criar automaticamente subtags "Outro" (Despesa e Receita)
                      </label>
                    </CadastroModalFieldsRow>
                  ) : null}
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => setShowTagModal(false)}
              onSave={() => {
                const form = document.getElementById('tag-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              saveLabel={editingTag ? 'Atualizar' : 'Criar'}
            />
          </form>
        </CadastroModalShell>
      )}

        {/* Modal de Subtag */}
        {showSubtagModal && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={!!editingSubtag}
            title={editingSubtag ? 'Editar Subtag' : 'Nova Subtag'}
            subtitle="Detalhe da categoria para receita ou despesa"
            onClose={() => setShowSubtagModal(false)}
            icon={<Tag size={18} />}
          />
          <form onSubmit={handleSubmitSubtag} className="flex min-h-0 flex-1 flex-col" id="subtag-form">
            <CadastroModalBody>
              <CadastroFormSection title="Identificação" icon={<Tag size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Tag</CadastroFieldLabel>
                      <select
                        required
                        value={subtagFormData.tag_id}
                        onChange={(e) => setSubtagFormData({ ...subtagFormData, tag_id: Number(e.target.value) })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        disabled={!!contextTagId}
                      >
                        <option value={0}>Selecione uma tag</option>
                        {hierarchicalData.map(h => (
                          <option key={h.tag.id} value={h.tag.id}>
                            {h.tag.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                      <input
                        type="text"
                        required
                        value={subtagFormData.name}
                        onChange={(e) => setSubtagFormData({ ...subtagFormData, name: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Restaurante"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                      <textarea
                        value={subtagFormData.description}
                        onChange={(e) => setSubtagFormData({ ...subtagFormData, description: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Descrição opcional"
                        rows={3}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <IconPicker
                      value={subtagFormData.icon}
                      onChange={(icon) => setSubtagFormData({ ...subtagFormData, icon })}
                      availableIcons={availableIcons}
                      iconNamesPt={iconNamesPt}
                    />
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Tipo</CadastroFieldLabel>
                      <select
                        required
                        value={subtagFormData.type}
                        onChange={(e) => setSubtagFormData({ ...subtagFormData, type: e.target.value })}
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
              onClose={() => setShowSubtagModal(false)}
              onSave={() => {
                const form = document.getElementById('subtag-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              saveLabel={editingSubtag ? 'Atualizar' : 'Criar'}
            />
          </form>
        </CadastroModalShell>
      )}

      {/* Dialogs */}
      {exportRunner.overlay}
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

