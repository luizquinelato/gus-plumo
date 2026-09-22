import { useState, useEffect, Fragment } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListCreateButton,
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
import { ListPageExpandRow, ListPageNestedTable, ListPageTable } from '../components/ListPageTable'
import {
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
  Plus, Edit2, Trash2, Tag, ChevronDown, ChevronRight
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
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Tag className="w-8 h-8" />}
              title="Tags e Subtags"
              subtitle="Gerencie suas tags e subtags de categorização"
              actions={
                <>
                  <button
                    type="button"
                    onClick={expandAll}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Expandir Tudo
                  </button>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Recolher Tudo
                  </button>
                  <CadastroListCreateButton label="Nova Tag" onClick={handleCreateTag} />
                </>
              }
            />
          }
          tabs={
            hierarchicalData.length > 0 ? (
              <div className="w-full max-w-md">
                <CadastroListPageSearchField
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Buscar tags ou subtags…"
                />
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
              action={<CadastroListCreateButton label="Criar primeira tag" onClick={handleCreateTag} />}
            />
          ) : filteredData.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<Tag size={32} className="text-gray-400" />}
              title="Nenhum resultado encontrado"
              description="Tente outro termo de busca."
            />
          ) : (
            <ListPageTable
              colsRest={<ListTableSpacerCol />}
              head={
                <tr>
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Tag" className="w-[28%]" />
                  <ListTableStaticHeader label="Descrição" className="w-[36%]" />
                  <ListTableStaticHeader label="Subtags" className="w-[12%]" />
                  <ListTableStaticHeader label="Ações" className="w-[14%]" />
                </tr>
              }
            >
              {filteredData.map((item, index) => {
                const IconComponent = getIconComponent(item.tag.icon || 'Tag')
                const isExpanded = expandedTags.has(item.tag.id)
                const despesas = item.subtags.filter((st) => st.type === 'despesa')
                const receitas = item.subtags.filter((st) => st.type === 'receita')
                return (
                  <Fragment key={item.tag.id}>
                    <tr
                      className={`${listPageTableRowHoverCls} ${
                        isExpanded
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_4%,transparent)] [&>td]:border-b-0'
                          : ''
                      }`}
                    >
                      <ListTableIndexCell index={index + 1} />
                      <ListTableSpacerCell />
                      <td className="cursor-pointer px-3 py-3" onClick={() => toggleTag(item.tag.id)}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTag(item.tag.id)
                            }}
                            className={cadastroRowIconBtnCls}
                            title={isExpanded ? 'Recolher' : 'Expandir'}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <IconComponent
                            size={16}
                            className="shrink-0"
                            style={{ color: isExpanded ? 'var(--color-1)' : undefined }}
                          />
                          <span
                            className={`text-sm font-semibold ${
                              isExpanded ? 'text-[var(--color-1)]' : 'text-gray-800 dark:text-gray-100'
                            }`}
                          >
                            {item.tag.name}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {item.tag.description || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={badgeVariantForColumnRole('metricGhost')}
                          tone="brand3"
                          label={item.subtagsCount}
                        />
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCreateSubtag(item.tag.id)}
                            className={cadastroRowIconBtnCls}
                            title="Nova subtag"
                          >
                            <Plus size={15} />
                          </button>
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
                      </td>
                    </tr>
                    {isExpanded && (
                      <ListPageExpandRow colSpan={6}>
                        {item.subtags.length === 0 ? (
                          <p className="text-sm text-gray-500">Nenhuma subtag cadastrada</p>
                        ) : (
                          <ListPageNestedTable
                            head={
                              <tr>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">#</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Subtag</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tipo</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Descrição</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ações</th>
                              </tr>
                            }
                          >
                            {([
                              ['Despesas', despesas, 'danger'] as const,
                              ['Receitas', receitas, 'success'] as const,
                            ]).flatMap(([groupLabel, rows, tone]) =>
                              rows.length === 0
                                ? []
                                : [
                                    <tr key={`${item.tag.id}-${groupLabel}`}>
                                      <td
                                        colSpan={5}
                                        className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                                      >
                                        {groupLabel} ({rows.length})
                                      </td>
                                    </tr>,
                                    ...rows.map((subtag, subIndex) => {
                                      const SubIcon = getIconComponent(subtag.icon || 'Tags')
                                      return (
                                        <tr key={subtag.id} className={listPageTableRowHoverCls}>
                                          <td className="px-3 py-2 font-mono text-[11px] text-gray-400">
                                            {subIndex + 1}
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                              <SubIcon size={14} className="shrink-0 text-gray-500" />
                                              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                                {subtag.name}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="px-3 py-2">
                                            <Badge
                                              variant={badgeVariantForColumnRole('classificationPrimary')}
                                              tone={tone}
                                              label={subtag.type === 'despesa' ? 'Despesa' : 'Receita'}
                                            />
                                          </td>
                                          <td className="truncate px-3 py-2 text-sm text-gray-500">
                                            {subtag.description || '—'}
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() => handleEditSubtag(subtag)}
                                                className={cadastroRowIconBtnCls}
                                                title="Editar subtag"
                                              >
                                                <Edit2 size={14} />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteSubtag(subtag.id)}
                                                className={cadastroRowIconDangerCls}
                                                title="Excluir subtag"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    }),
                                  ],
                            )}
                          </ListPageNestedTable>
                        )}
                      </ListPageExpandRow>
                    )}
                  </Fragment>
                )
              })}
            </ListPageTable>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {/* Modal de Tag */}
      {showTagModal && (
        <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={() => setShowTagModal(false)}>
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
        <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={() => setShowSubtagModal(false)}>
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

