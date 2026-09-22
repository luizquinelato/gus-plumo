import { useState, useEffect, Fragment } from 'react'
import Sidebar from '../components/Sidebar'
import {
  CadastroListCreateButton,
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
  listPageTableRowInactiveCls,
  type StatusFilter,
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
import StatusSwitch from '../components/StatusSwitch'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import Toast from '../components/Toast'
import TemplateFormModal from '../components/TemplateFormModal'
import ApplyTemplateModal from '../components/ApplyTemplateModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { Edit2, Trash2, FileText, Play, ChevronDown, ChevronRight, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
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

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    loadTemplates()
    loadIcons()
  }, [])

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

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<FileText className="w-8 h-8" />}
              title="Templates de Lançamentos"
              subtitle="Crie templates reutilizáveis para agilizar lançamentos recorrentes"
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
                  <CadastroListCreateButton label="Novo Template" onClick={handleCreate} />
                </>
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
                  <div className="w-72">
                    <CadastroListPageSearchField
                      value={searchTerm}
                      onChange={setSearchTerm}
                      placeholder="Buscar templates…"
                    />
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
              action={<CadastroListCreateButton label="Criar primeiro template" onClick={handleCreate} />}
            />
          ) : filteredTemplates.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<FileText size={32} className="text-gray-400" />}
              title={searchTerm ? 'Nenhum resultado encontrado' : statusFilter === 'inactive' ? 'Nenhum template inativo' : 'Nenhum template ativo'}
              description="Não há templates neste filtro."
            />
          ) : (
            <ListPageTable
              colsRest={<ListTableSpacerCol />}
              head={
                <tr>
                  <ListTableIndexHeader />
                  <ListTableSpacerHeader />
                  <ListTableStaticHeader label="Nome" className="w-[28%]" />
                  <ListTableStaticHeader label="Descrição" className="w-[28%]" />
                  <ListTableStaticHeader label="Itens" className="w-[10%]" />
                  <ListTableStaticHeader label="Status" className="w-[12%]" />
                  <ListTableStaticHeader label="Ações" className="w-[12%]" />
                </tr>
              }
            >
              {filteredTemplates.map((template, index) => {
                const IconComponent = getIconComponent(template.icon)
                const isExpanded = expandedTemplates.has(template.id)
                return (
                  <Fragment key={template.id}>
                    <tr
                      className={`${listPageTableRowHoverCls} ${
                        !template.active ? listPageTableRowInactiveCls : ''
                      } ${
                        isExpanded
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_4%,transparent)] [&>td]:border-b-0'
                          : ''
                      }`}
                    >
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
                          <div
                            className="flex-shrink-0 rounded-md p-1.5"
                            style={{ background: 'var(--gradient-1-2)' }}
                          >
                            <IconComponent size={15} style={{ color: 'var(--on-gradient-1-2)' }} />
                          </div>
                          <span
                            className={`text-sm font-semibold ${
                              isExpanded ? 'text-[var(--color-1)]' : 'text-gray-800 dark:text-gray-100'
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
                      </td>
                    </tr>
                    {isExpanded && (
                      <ListPageExpandRow colSpan={7}>
                        {template.items.length === 0 ? (
                          <p className="text-sm text-gray-500">Nenhum item cadastrado</p>
                        ) : (
                          <ListPageNestedTable
                            head={
                              <tr>
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
                              <tr key={item.id} className={listPageTableRowHoverCls}>
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

