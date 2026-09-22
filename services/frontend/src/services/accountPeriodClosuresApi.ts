import axios from 'axios'
import type {
  AccountPeriodBulkCloseResponse,
  AccountPeriodClosedValidation,
  AccountPeriodFilterOptions,
  AccountPeriodMonth,
  AccountPeriodYearResponse,
} from '../types/accountPeriodClosure'

const BASE_URL = '/api/account-period-closures'

export async function listAccountPeriodClosureOptions(): Promise<AccountPeriodFilterOptions> {
  const response = await axios.get<AccountPeriodFilterOptions>(`${BASE_URL}/options`)
  return response.data
}

export async function listAccountPeriodClosures(
  year?: number | null,
  allYears = false,
): Promise<AccountPeriodYearResponse> {
  const response = await axios.get<AccountPeriodYearResponse>(BASE_URL, {
    params: allYears ? { all_years: true } : { year },
  })
  return response.data
}

export async function previewAccountPeriod(year: number, month: number): Promise<AccountPeriodMonth> {
  const response = await axios.get<AccountPeriodMonth>(`${BASE_URL}/preview`, { params: { year, month } })
  return response.data
}

export async function closeAccountPeriod(payload: {
  year: number
  month: number
  adjustment?: number
  notes?: string
}): Promise<AccountPeriodMonth> {
  const response = await axios.post<AccountPeriodMonth>(BASE_URL, payload)
  return response.data
}

export async function bulkCloseAccountPeriods(payload: {
  months: Array<{ year: number; month: number }>
  adjustment?: number
  notes?: string
}): Promise<AccountPeriodBulkCloseResponse> {
  const response = await axios.post<AccountPeriodBulkCloseResponse>(`${BASE_URL}/bulk`, payload)
  return response.data
}

export async function reopenAccountPeriod(closureId: number): Promise<AccountPeriodMonth> {
  const response = await axios.delete<AccountPeriodMonth>(`${BASE_URL}/${closureId}`)
  return response.data
}

export async function validateAccountPeriodDate(date: string): Promise<AccountPeriodClosedValidation> {
  const response = await axios.get<AccountPeriodClosedValidation>(`${BASE_URL}/validate-date`, {
    params: { date },
  })
  return response.data
}
