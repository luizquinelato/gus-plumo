import axios from 'axios'

export function messageFromUnknownError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
