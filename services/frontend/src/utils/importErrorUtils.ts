/** Converte `detail` de erro FastAPI/axios em linhas para exibir na UI. */
export function formatImportApiError(detail: unknown): string[] {
  if (detail == null || detail === '') {
    return ['Erro ao processar arquivo']
  }

  if (typeof detail === 'string') {
    return detail
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  if (Array.isArray(detail)) {
    return detail.flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (item && typeof item === 'object') {
        const rec = item as { msg?: string; message?: string }
        if (rec.msg) return [rec.msg]
        if (rec.message) return [rec.message]
      }
      return [JSON.stringify(item)]
    })
  }

  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return formatImportApiError((detail as { message: unknown }).message)
  }

  return [String(detail)]
}
