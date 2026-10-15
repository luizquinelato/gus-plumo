import { downloadPdf, type PdfBlock, type PdfColumn } from './pdfExportClient'
import {
  asOutflow,
  cardLabel,
  exportFileStamp,
  sharingLabel,
  type SaldoParceladoExportData,
} from './saldoParceladoExportShared'

function money(value: number): string {
  return value
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\s/g, ' ')
}

export async function exportSaldoParceladoToPdf(data: SaldoParceladoExportData): Promise<void> {
  const { summary, share } = data
  const shareLabel = share === 'mine' ? 'Minha parte' : 'Valor integral'
  const right = (header: string): PdfColumn => ({ header, align: 'right' })

  const chartNote =
    (data.chartMode === 'consolidated'
      ? 'Barras: parcelas do mês · Linha: saldo que resta após o mês'
      : 'Barras empilhadas por cartão · Linha: saldo que resta após o mês') +
    (data.monthsTruncated ? ` · exibindo os primeiros ${data.months.length} meses` : '')

  const blocks: PdfBlock[] = [
    {
      type: 'cards',
      cards: [
        { label: 'Saldo total parcelado', value: money(asOutflow(summary.future_total)), note: shareLabel, tone: 'negative' },
        {
          label: `Próximo período${summary.next_month_label ? ` · ${summary.next_month_label}` : ''}`,
          value: money(asOutflow(summary.next_month_total)),
          note: 'Primeira competência após a fatura-base',
          tone: 'negative',
        },
        {
          label: 'Compras em aberto',
          value: String(summary.purchases_count),
          note: `${summary.remaining_installments_count} parcelas a vencer`,
        },
        {
          label: 'Última parcela',
          value: summary.last_projected_month_label ?? '-',
          note: `${summary.months_count} ${summary.months_count === 1 ? 'mês' : 'meses'} com parcelas`,
        },
      ],
    },
    { type: 'heading', text: 'Projeção mês a mês' },
    { type: 'text', text: chartNote, tone: 'muted' },
  ]

  if (data.chartImage) {
    blocks.push(
      { type: 'image', image_data_url: data.chartImage.dataUrl, max_height_mm: 80 },
      { type: 'legend', legend: data.legend.map((e) => ({ name: e.name, color: e.color, kind: e.kind })) },
    )
  } else {
    blocks.push({ type: 'text', text: 'Gráfico indisponível.', tone: 'muted' })
  }

  blocks.push(
    { type: 'heading', text: 'Parcelas por mês' },
    {
      type: 'table',
      font_size: 8,
      columns: [{ header: 'Mês' }, right('Parcelas'), right('Total do mês'), right('Saldo após o mês')],
      rows: data.months.map((m) => [m.month_label, String(m.count), money(m.total), money(m.remaining_after)]),
      footer: ['Total projetado', String(summary.remaining_installments_count), money(summary.future_total), ''],
    },
    { type: 'heading', text: 'Saldo por cartão' },
    {
      type: 'table',
      font_size: 8,
      columns: [{ header: 'Cartão' }, right('Compras'), right('Saldo parcelado')],
      rows: data.cards.map((c) => [
        cardLabel(c.card_name, c.card_number, data.inactiveCardIds.has(c.card_id)),
        String(c.purchases_count),
        money(c.remaining_total),
      ]),
    },
    { type: 'heading', text: 'Compras parceladas em aberto' },
    {
      type: 'table',
      font_size: 6.5,
      columns: [
        { header: 'Cartão' },
        { header: 'Descrição' },
        { header: 'Tag / Subtag' },
        { header: 'Compart.' },
        { header: 'Parcelas', align: 'center' },
        right('Parcela'),
        right('Saldo'),
        { header: 'Até' },
      ],
      rows: data.items.map((it) => [
        cardLabel(it.card_name, it.card_number, data.inactiveCardIds.has(it.card_id)),
        it.description || '-',
        [it.tag_name, it.subtag_name].filter(Boolean).join(' / ') || '-',
        sharingLabel(it) || '-',
        `${it.remaining_installments} (${it.current_installment}/${it.total_installments})`,
        money(asOutflow(it.installment_amount)),
        money(asOutflow(it.remaining_total)),
        it.last_projected_month || '-',
      ]),
    },
  )

  await downloadPdf(`saldo_parcelado_${exportFileStamp()}.pdf`, {
    title: 'Saldo Parcelado',
    subtitle: shareLabel,
    blocks,
  })
}
