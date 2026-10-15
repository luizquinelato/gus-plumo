import axios from 'axios'
import { saveBlob } from './excelExportClient'
import {
  cardLabel,
  exportFileStamp,
  sharingLabel,
  type SaldoParceladoExportData,
} from './saldoParceladoExportShared'

/**
 * Gera o Excel no backend (XlsxWriter), que monta o gráfico nativo.
 * Envia os dados exatamente como estão na tela (filtros, ordenação e modo do gráfico).
 */
export async function exportSaldoParceladoToExcel(data: SaldoParceladoExportData): Promise<void> {
  const inactive = (cardId: number) => data.inactiveCardIds.has(cardId)
  const barLegend = data.legend.filter((l) => l.kind === 'bar')
  const lineLegend = data.legend.find((l) => l.kind === 'line')

  const bars =
    data.chartMode === 'consolidated'
      ? barLegend.map((l) => ({ name: l.name, color: l.color, values: data.months.map((m) => m.total) }))
      : barLegend.map((l, i) => {
          const cardId = data.cards[i]?.card_id
          return {
            name: l.name,
            color: l.color,
            values: data.months.map((m) => Number(m.by_card?.[String(cardId)] ?? 0)),
          }
        })

  const payload = {
    share: data.share,
    stacked: data.chartMode === 'by_card',
    line_name: lineLegend?.name ?? 'Saldo restante',
    line_color: lineLegend?.color ?? '#7c3aed',
    summary: data.summary,
    months: data.months.map((m) => ({
      month_label: m.month_label,
      total: m.total,
      count: m.count,
      remaining_after: m.remaining_after,
    })),
    bars,
    cards: data.cards.map((c) => ({
      card_label: cardLabel(c.card_name, c.card_number, inactive(c.card_id)),
      remaining_total: c.remaining_total,
      purchases_count: c.purchases_count,
    })),
    items: data.items.map((it) => ({
      card_label: cardLabel(it.card_name, it.card_number, inactive(it.card_id)),
      description: it.description || '',
      tag_name: it.tag_name,
      subtag_name: it.subtag_name,
      sharing: sharingLabel(it),
      remaining_installments: it.remaining_installments,
      current_installment: it.current_installment,
      total_installments: it.total_installments,
      installment_amount: it.installment_amount,
      remaining_total: it.remaining_total,
      last_projected_month: it.last_projected_month || null,
    })),
  }

  const response = await axios.post<Blob>('/api/reports/installments/export-excel', payload, {
    responseType: 'blob',
  })
  saveBlob(response.data, `saldo_parcelado_${exportFileStamp()}.xlsx`)
}