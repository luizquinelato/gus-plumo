/**
 * API Client para Expense Templates
 * Funções para chamar os endpoints do backend
 */

import axios from 'axios'
import type {
  ExpenseTemplate,
  ExpenseTemplateCreate,
  ExpenseTemplateUpdate,
  ExpenseTemplateItem,
  ExpenseTemplateItemCreate,
  ExpenseTemplateItemUpdate,
  ApplyTemplateRequest,
  ApplyTemplateResponse
} from '../types/expenseTemplate'

const BASE_URL = '/api/expense-templates'

/**
 * Lista todos os templates da conta logada
 */
export const listTemplates = async (incluirInativos: boolean = false): Promise<ExpenseTemplate[]> => {
  const response = await axios.get<ExpenseTemplate[]>(BASE_URL, {
    params: { incluir_inativos: incluirInativos }
  })
  return response.data
}

/**
 * Obtém um template específico com todos os seus itens
 */
export const getTemplate = async (templateId: number): Promise<ExpenseTemplate> => {
  const response = await axios.get<ExpenseTemplate>(`${BASE_URL}/${templateId}`)
  return response.data
}

/**
 * Cria um novo template com seus itens
 */
export const createTemplate = async (data: ExpenseTemplateCreate): Promise<ExpenseTemplate> => {
  const response = await axios.post<ExpenseTemplate>(BASE_URL, data)
  return response.data
}

/**
 * Atualiza um template existente (apenas cabeçalho)
 */
export const updateTemplate = async (
  templateId: number,
  data: ExpenseTemplateUpdate
): Promise<ExpenseTemplate> => {
  const response = await axios.put<ExpenseTemplate>(`${BASE_URL}/${templateId}`, data)
  return response.data
}

/**
 * Deleta (soft delete) um template
 */
export const deleteTemplate = async (templateId: number): Promise<void> => {
  await axios.delete(`${BASE_URL}/${templateId}`)
}

/**
 * Aplica um template criando bank_statements
 */
export const applyTemplate = async (
  templateId: number,
  request: ApplyTemplateRequest
): Promise<ApplyTemplateResponse> => {
  const response = await axios.post<ApplyTemplateResponse>(
    `${BASE_URL}/${templateId}/apply`,
    request
  )
  return response.data
}

// ==================== ENDPOINTS DE ITENS ====================

/**
 * Adiciona um novo item a um template
 */
export const addTemplateItem = async (
  templateId: number,
  data: ExpenseTemplateItemCreate
): Promise<ExpenseTemplateItem> => {
  const response = await axios.post<ExpenseTemplateItem>(
    `${BASE_URL}/${templateId}/items`,
    data
  )
  return response.data
}

/**
 * Atualiza um item existente de um template
 */
export const updateTemplateItem = async (
  templateId: number,
  itemId: number,
  data: ExpenseTemplateItemUpdate
): Promise<ExpenseTemplateItem> => {
  const response = await axios.put<ExpenseTemplateItem>(
    `${BASE_URL}/${templateId}/items/${itemId}`,
    data
  )
  return response.data
}

/**
 * Deleta (hard delete) um item de um template
 */
export const deleteTemplateItem = async (
  templateId: number,
  itemId: number
): Promise<void> => {
  await axios.delete(`${BASE_URL}/${templateId}/items/${itemId}`)
}

