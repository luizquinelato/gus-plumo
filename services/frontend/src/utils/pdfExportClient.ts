import axios from 'axios'
import { saveBlob } from './excelExportClient'

/**
 * Cliente do motor único de PDF (backend, ReportLab) — `/api/reports/export-pdf`.
 * Os dados já vêm formatados da tela; o backend só desenha e devolve o .pdf.
 */

export type PdfTone = 'text' | 'muted' | 'brand' | 'positive' | 'negative'
export type PdfAlign = 'left' | 'right' | 'center'

export interface PdfColumn {
  header: string
  width_mm?: number
  align?: PdfAlign
}

export interface PdfCard {
  label: string
  value: string
  note?: string
  tone?: PdfTone
}

export interface PdfLegendEntry {
  name: string
  color?: string
  kind?: 'bar' | 'line'
}

export type PdfBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; tone?: PdfTone; italic?: boolean; bold?: boolean }
  | {
      type: 'table'
      font_size?: number
      columns: PdfColumn[]
      rows: string[][]
      footer?: string[]
      /** Cor por célula do corpo, no mesmo formato de `rows`. */
      tones?: (PdfTone | null)[][]
      footer_tones?: (PdfTone | null)[]
      bold_columns?: number[]
      /** Estilo por linha: '', 'daily' ou 'daily_month_end'. */
      row_styles?: string[]
    }
  | { type: 'cards'; cards: PdfCard[] }
  | { type: 'image'; image_data_url: string; max_height_mm?: number }
  | { type: 'legend'; legend: PdfLegendEntry[] }
  | { type: 'pie'; slices: { name: string; value: number; color: string }[] }
  | { type: 'page_break' }

/** Documento com vários blocos, desenhados na ordem. */
export interface PdfDocumentSpec {
  title: string
  subtitle?: string
  blocks: PdfBlock[]
}

/** Atalho de tabela única (extrato e faturas). */
export interface PdfTableSpec {
  title: string
  subtitle?: string
  font_size?: number
  columns: PdfColumn[]
  rows: string[][]
  footer?: string[]
  signed_column?: number
  signs?: number[]
}

export function pdfGeneratedAtLabel(): string {
  return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Gera o PDF no backend e baixa. Lança erro se a geração falhar. */
export async function downloadPdf(filename: string, spec: PdfDocumentSpec | PdfTableSpec): Promise<void> {
  const response = await axios.post<Blob>(
    '/api/reports/export-pdf',
    { ...spec, generated_at: pdfGeneratedAtLabel() },
    { responseType: 'blob' },
  )
  saveBlob(response.data, filename)
}
