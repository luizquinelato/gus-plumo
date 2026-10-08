import jsPDF from 'jspdf'
import autoTableLib from 'jspdf-autotable'
import type { ExpenseExportData } from './exportToExcel'

const autoTable = (doc: jsPDF, options: Parameters<typeof autoTableLib>[1]) => {
  autoTableLib(doc, options)
}

function formatDateBr(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('pt-BR')
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function sourceLabel(source: string): string {
  if (source === 'bank') return 'Extrato'
  if (source === 'benefit') return 'Benefício'
  if (source === 'card') return 'Cartão'
  return source
}

export function exportExtratoReportToPdf(expenses: ExpenseExportData[], title = 'Extrato de transações'): void {
  if (!expenses.length) return

  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(title, 14, 16)
  doc.setFontSize(9)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} · ${expenses.length} lançamento(s)`, 14, 22)

  autoTable(doc, {
    startY: 28,
    head: [['Data', 'Descrição', 'Valor', 'Tag', 'Subtag', 'Fonte']],
    body: expenses.map((row) => [
      formatDateBr(row.date),
      (row.description || '').slice(0, 80),
      formatMoney(row.amount),
      row.tag_name || '',
      row.subtag_name || '',
      sourceLabel(row.source),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [55, 65, 81] },
    columnStyles: {
      2: { halign: 'right' },
    },
  })

  const stamp = new Date()
  const file = `extrato_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}.pdf`
  doc.save(file)
}
