import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  CadastroListPageTabs,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableRowHoverCls,
  type StatusFilter,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import { usePageWriteAllowed, WriteGate } from '../contexts/PageMutationContext'
import BulkSelectCheckbox, { type HeaderCheckState } from '../components/BulkSelectCheckbox'
import { ListPageExpandRow, ListPageNestedTable, ListPageTable } from '../components/ListPageTable'
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
import { selectionHeaderState } from '../utils/listTableSelection'
import StatusSwitch from '../components/StatusSwitch'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import Toast from '../components/Toast'
import TemplateFormModal from '../components/TemplateFormModal'
import ApplyTemplateModal from '../components/ApplyTemplateModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import {
  Edit2, Trash2, FileText, Play, ChevronDown, ChevronRight, ArrowDownCircle, ArrowUpCircle, ArrowUp, X,
  ChevronsDown, ChevronsUp,
} from 'lucide-react'
import { getIconComponent } from '../utils/iconMapper'
import { useConfirm } from '../hooks/useConfirm'
import { useExportRunner } from '../hooks/useExportRunner'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate } from '../types/expenseTemplate'
import * as templatesApi from '../services/expenseTemplatesApi'
import axios from 'axios'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { exportTemplatesToExcel } from '../utils/exportCadastroExcel'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const TEMPLATE_TABLE_COL_SPAN = 8

const ExpenseTemplatesPage = () => {
  const canWrite = usePageWriteAllowed()
  const { showConfirm, ConfirmComponent } = useConfirm()
  const { AlertComponent } = useAlert()

  const [templates, setTemplates] = useState<ExpenseTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
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
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<number>>(() => new Set())
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const exportRunner = useExportRunner((message) => showToast(message, 'error'))

  useEffect(() => {
    loadTemplates()
    loadIcons()
  }, [])

  const scrollToTop = useCallback(() => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => setShowBackToTop(container.scrollTop > 300)
    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isLoading, templates.length, statusFilter, searchTerm])

  const loadTemplates = async () => {
    try {
      setIsLoading(true)
      const data = await templatesApi.listTemplates(true)
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

  const handleToggleActive = (template: ExpenseTemplate) => {
    if (template.active) {
      showConfirm(
        'Inativar Template',
        `Tem certeza que deseja inativar o template "${template.name}"?`,
        async () => {
          try {
            await templatesApi.deleteTemplate(template.id)
            showToast('Template inativado com sucesso!', 'success')
            loadTemplates()
          } catch (error: any) {
            console.error('Erro ao inativar template:', error)
            showToast(error.response?.data?.detail || 'Erro ao inativar template', 'error')
          }
        },
        'Inativar',
        'Cancelar',
      )
    } else {
      showConfirm(
        'Reativar Template',
        `Tem certeza que deseja reativar o template "${template.name}"?`,
        async () => {
          try {
            await templatesApi.updateTemplate(template.id, { active: true })
            showToast('Template reativado com sucesso!', 'success')
            loadTemplates()
          } catch (error: any) {
            console.error('Erro ao reativar template:', error)
            showToast(error.response?.data?.detail || 'Erro ao reativar template', 'error')
          }
        },
        'Reativar',
        'Cancelar',
      )
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
    loadTemplates()
  }

  const templatesAtivos = templates.filter((t) => t.active)
  const templatesInativos = templates.filter((t) => !t.active)
  const templatesPorStatus = statusFilter === 'active'
    ? templatesAtivos
    : statusFilter === 'inactive'
      ? templatesInativos
      : templates

  const filteredTemplates = templatesPorStatus.filter((template) => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    const matchesTemplate =
      template.name.toLowerCase().includes(searchLower) ||
      (template.description && template.description.toLowerCase().includes(searchLower))
    const matchesItems = template.items?.some((item) =>
      item.description.toLowerCase().includes(searchLower),
    )
    return matchesTemplate || matchesItems
  })

  const expandAllTemplates = useCallback(() => {
    setExpandedTemplates(new Set(filteredTemplates.map((t) => t.id)))
  }, [filteredTemplates])

  const collapseAllTemplates = useCallback(() => {
    setExpandedTemplates(new Set())
  }, [])

  const allVisibleTemplatesExpanded = useMemo(
    () =>
      filteredTemplates.length > 0 &&
      filteredTemplates.every((t) => expandedTemplates.has(t.id)),
    [filteredTemplates, expandedTemplates],
  )

  const toggleExpandAllTemplates = useCallback(() => {
    if (allVisibleTemplatesExpanded) collapseAllTemplates()
    else expandAllTemplates()
  }, [allVisibleTemplatesExpanded, collapseAllTemplates, expandAllTemplates])

  const visibleTemplateIds = useMemo(() => filteredTemplates.map((t) => t.id), [filteredTemplates])
  const visibleItemIds = useMemo(
    () => filteredTemplates.flatMap((t) => t.items.map((item) => item.id)),
    [filteredTemplates],
  )

  const globalHeaderState = useMemo((): HeaderCheckState => {
    let selectedCount = 0
    for (const id of visibleTemplateIds) {
      if (selectedTemplateIds.has(id)) selectedCount += 1
    }
    for (const id of visibleItemIds) {
      if (selectedItemIds.has(id)) selectedCount += 1
    }
    const total = visibleTemplateIds.length + visibleItemIds.length
    if (selectedCount === 0) return 'none'
    if (selectedCount === total) return 'all'
    return 'partial'
  }, [visibleTemplateIds, visibleItemIds, selectedTemplateIds, selectedItemIds])

  const bulkSelectionCount = useMemo(() => {
    let count = selectedTemplateIds.size
    for (const template of templates) {
      if (selectedTemplateIds.has(template.id)) continue
      for (const item of template.items) {
        if (selectedItemIds.has(item.id)) count += 1
      }
    }
    return count
  }, [templates, selectedTemplateIds, selectedItemIds])

  const toggleGlobalSelection = useCallback(() => {
    const anySelected =
      visibleTemplateIds.some((id) => selectedTemplateIds.has(id)) ||
      visibleItemIds.some((id) => selectedItemIds.has(id))
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev)
      if (anySelected) visibleTemplateIds.forEach((id) => next.delete(id))
      else visibleTemplateIds.forEach((id) => next.add(id))
      return next
    })
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (anySelected) visibleItemIds.forEach((id) => next.delete(id))
      else visibleItemIds.forEach((id) => next.add(id))
      return next
    })
  }, [visibleTemplateIds, visibleItemIds, selectedTemplateIds, selectedItemIds])

  const toggleTemplateSelection = useCallback((templateId: number) => {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }, [])

  const toggleItemSelection = useCallback((itemId: number) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const toggleAllItemsForTemplate = useCallback(
    (template: ExpenseTemplate) => {
      const ids = template.items.map((item) => item.id)
      const state = selectionHeaderState(ids, selectedItemIds)
      setSelectedItemIds((prev) => {
        const next = new Set(prev)
        if (state === 'all') ids.forEach((id) => next.delete(id))
        else ids.forEach((id) => next.add(id))
        return next
      })
    },
    [selectedItemIds],
  )

  const clearBulkSelection = useCallback(() => {
    setSelectedTemplateIds(new Set())
    setSelectedItemIds(new Set())
  }, [])

  const handleBulkDelete = () => {
    const templateIds = [...selectedTemplateIds]
    const itemDeletes: { templateId: number; itemId: number }[] = []
    for (const template of templates) {
      if (selectedTemplateIds.has(template.id)) continue
      for (const item of template.items) {
        if (selectedItemIds.has(item.id)) {
          itemDeletes.push({ templateId: template.id, itemId: item.id })
        }
      }
    }
    if (templateIds.length === 0 && itemDeletes.length === 0) return

    const parts: string[] = []
    if (templateIds.length > 0) {
      parts.push(`${templateIds.length} template${templateIds.length === 1 ? '' : 's'}`)
    }
    if (itemDeletes.length > 0) {
      parts.push(`${itemDeletes.length} ${itemDeletes.length === 1 ? 'item' : 'itens'}`)
    }

    showConfirm(
      'Excluir seleção',
      `Excluir ${parts.join(' e ')}? Templates excluídos são inativados (soft delete). Itens são removidos permanentemente.`,
      async () => {
        setBulkDeleting(true)
        try {
          const data = await templatesApi.bulkDeleteTemplates({
            template_ids: templateIds,
            items: itemDeletes.map(({ templateId, itemId }) => ({
              template_id: templateId,
              item_id: itemId,
            })),
          })
          clearBulkSelection()
          await loadTemplates()
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
              icon={<FileText className="w-8 h-8" />}
              title="Templates de Lançamentos"
              subtitle="Crie templates reutilizáveis para agilizar lançamentos recorrentes"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    exportDisabled: filteredTemplates.length === 0,
                    onExportExcel: () => {
                      void exportRunner.run('Gerando Excel…', () => exportTemplatesToExcel(filteredTemplates))
                    },
                  }}
                >
                  <CadastroListCreateButton label="Novo Template" onClick={handleCreate} />
                </CadastroListHeaderActions>
              }
            />
          }
          tabs={
            templates.length > 0 ? (
              <CadastroListPageTabs
                tabs={[
                  { key: 'all', label: 'Todos', count: templates.length },
                  { key: 'active', label: 'Ativos', count: templatesAtivos.length },
                  { key: 'inactive', label: 'Inativos', count: templatesInativos.length },
                ]}
                active={statusFilter}
                onChange={setStatusFilter}
                trailing={
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={toggleExpandAllTemplates}
                      disabled={filteredTemplates.length === 0}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      {allVisibleTemplatesExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
                      {allVisibleTemplatesExpanded ? 'Recolher todas' : 'Expandir todas'}
                    </button>
                    <div className="w-full max-w-xs min-w-[12rem]">
                      <CadastroListPageSearchField
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder="Buscar templates…"
                      />
                    </div>
                  </div>
                }
              />
            ) : undefined
          }
        >
          {isLoading ? (
            <CadastroListPageLoading label="Carregando templates…" />
          ) : templates.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<FileText size={32} className="text-gray-400" />}
              title="Nenhum template cadastrado"
              description="Crie templates reutilizáveis para agilizar lançamentos recorrentes"
            />
          ) : filteredTemplates.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<FileText size={32} className="text-gray-400" />}
              title={searchTerm ? 'Nenhum resultado encontrado' : statusFilter === 'inactive' ? 'Nenhum template inativo' : 'Nenhum template ativo'}
              description="Não há templates neste filtro."
            />
          ) : (
            <ListPageTable
              leadingMode="bulk"
              colsRest={
                <>
                  <ListTableSpacerCol />
                  <col />
                  <col />
                  <col style={{ width: 90, minWidth: 90 }} />
                  <col style={{ width: 120, minWidth: 120 }} />
                  <col style={{ width: 128, minWidth: 128 }} />
                </>
              }
              head={
                <tr>
                  <ListTableCheckboxHeader state={globalHeaderState} onToggle={toggleGlobalSelection} />
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Nome" />
                  <ListTableStaticHeader label="Descrição" />
                  <ListTableStaticHeader label="Itens" />
                  <ListTableStaticHeader label="Status" />
                  <ListTableStaticHeader label="Ações" />
                </tr>
              }
            >
              {filteredTemplates.map((template, index) => {
                const IconComponent = getIconComponent(template.icon)
                const isExpanded = expandedTemplates.has(template.id)
                const templateSelected = selectedTemplateIds.has(template.id)
                const templateItemIds = template.items.map((item) => item.id)
                const templateItemsState = selectionHeaderState(templateItemIds, selectedItemIds)
                const rowSelected = templateSelected || templateItemsState !== 'none'
                return (
                  <Fragment key={template.id}>
                    <tr
                      className={`${listPageTableRowHoverCls} ${
                        isExpanded
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_4%,transparent)] [&>td]:border-b-0'
                          : ''
                      } ${
                        rowSelected && !isExpanded
                          ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]'
                          : ''
                      }`}
                    >
                      <ListTableCheckboxCell
                        checked={templateSelected}
                        onToggle={() => toggleTemplateSelection(template.id)}
                      />
                      <ListTableIndexCell index={index + 1} />
                      <ListTableSpacerCell />
                      <td className="cursor-pointer px-3 py-3" onClick={() => toggleTemplate(template.id)}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTemplate(template.id)
                            }}
                            className={cadastroRowIconBtnCls}
                            title={isExpanded ? 'Recolher' : 'Expandir'}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <IconComponent size={16} className="shrink-0" style={{ color: 'var(--color-1)' }} />
                          <span
                            className={`text-sm font-semibold ${
                              isExpanded
                                ? 'text-[var(--color-1)]'
                                : template.active
                                  ? 'text-gray-800 dark:text-gray-100'
                                  : 'text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {template.name}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {template.description || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={badgeVariantForColumnRole('metricGhost')}
                          tone="brand3"
                          label={template.items.length}
                        />
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <StatusSwitch
                          checked={template.active}
                          onChange={() => handleToggleActive(template)}
                          size="sm"
                          labelOn="Ativo"
                          labelOff="Inativo"
                          showLabel
                        />
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <CadastroRowMutations>
                          <div className="flex items-center gap-1">
                            {template.active && (
                              <button
                                type="button"
                                onClick={() => handleApply(template)}
                                className={cadastroRowIconBtnCls}
                                title="Usar template"
                              >
                                <Play size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleEdit(template)}
                              className={cadastroRowIconBtnCls}
                              title="Editar"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(template)}
                              className={cadastroRowIconDangerCls}
                              title="Excluir"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </CadastroRowMutations>
                      </td>
                    </tr>
                    {isExpanded && (
                      <ListPageExpandRow colSpan={TEMPLATE_TABLE_COL_SPAN}>
                        {template.items.length > 0 && (
                          <div className="mb-3 flex items-center gap-2">
                            <BulkSelectCheckbox
                              state={templateItemsState}
                              onClick={() => toggleAllItemsForTemplate(template)}
                            />
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                              Selecionar todos os itens deste template
                            </span>
                          </div>
                        )}
                        {template.items.length === 0 ? (
                          <p className="text-sm text-gray-500">Nenhum item cadastrado</p>
                        ) : (
                          <ListPageNestedTable
                            head={
                              <tr>
                                <th className="w-10 px-2 py-2" aria-label="Selecionar" />
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">#</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tipo</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Descrição</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tag</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Subtag</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Valor</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Dia</th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Compartilhamento</th>
                              </tr>
                            }
                          >
                            {template.items.map((item, itemIndex) => (
                              <tr
                                key={item.id}
                                className={`${listPageTableRowHoverCls} ${
                                  selectedItemIds.has(item.id)
                                    ? 'bg-[color-mix(in_srgb,var(--color-1)_6%,transparent)]'
                                    : ''
                                }`}
                              >
                                <td className="px-2 py-2">
                                  <BulkSelectCheckbox
                                    checked={selectedItemIds.has(item.id)}
                                    onClick={() => toggleItemSelection(item.id)}
                                  />
                                </td>
                                <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{itemIndex + 1}</td>
                                <td className="px-3 py-2">
                                  {item.subtag ? (
                                    item.subtag.type === 'receita' ? (
                                      <span title="Receita">
                                        <ArrowUpCircle size={14} className="text-emerald-600" />
                                      </span>
                                    ) : (
                                      <span title="Despesa">
                                        <ArrowDownCircle size={14} className="text-red-500" />
                                      </span>
                                    )
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                                  {item.description}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                                  {item.subtag?.tag_name || '—'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                                  {item.subtag?.name || '—'}
                                </td>
                                <td className="px-3 py-2 text-sm font-semibold tabular-nums">
                                  {item.amount != null ? (
                                    <span className={item.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                                  {item.day_of_month ?? '—'}
                                </td>
                                <td className="px-3 py-2">
                                  <SharedAccountDisplay
                                    account={item.expense_sharing?.shared_account}
                                    ownershipPercentage={item.ownership_percentage || 100}
                                  />
                                </td>
                              </tr>
                            ))}
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

      {canWrite && bulkSelectionCount > 0 && (
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
                  onClick={handleBulkDelete}
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

      {showBackToTop && bulkSelectionCount === 0 && (
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
          loadTemplates()
        }}
        onSuccess={handleApplySuccess}
        template={applyingTemplate}
      />

      {exportRunner.overlay}
      <ConfirmComponent />
      <AlertComponent />
    </div>
  )
}

export default ExpenseTemplatesPage

