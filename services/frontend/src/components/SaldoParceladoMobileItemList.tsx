import { CreditCard } from 'lucide-react'
import SharedAccountDisplay from './SharedAccountDisplay'
import { formatCurrency } from '../utils/currency'

export type SaldoParceladoMobileItem = {
  id: number
  description: string
  card_name: string
  card_number: string
  tag_name: string | null
  subtag_name: string | null
  shared_partner_name: string | null
  shared_partner_id: number | null
  ownership_percentage: number
  current_installment: number
  total_installments: number
  remaining_installments: number
  installment_amount: number
  remaining_total: number
  last_projected_month: string
}

type Props = {
  items: SaldoParceladoMobileItem[]
}

export default function SaldoParceladoMobileItemList({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Nenhuma compra em aberto.</p>
    )
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {items.map((item) => (
        <li key={item.id} className="list-none px-3 py-3">
          <article className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">{item.description}</p>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-danger)]">
                {formatCurrency(item.remaining_total)}
              </p>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <CreditCard size={12} className="shrink-0" />
              <span className="truncate">
                {item.card_name} · {item.card_number}
              </span>
            </p>
            {[item.tag_name, item.subtag_name].filter(Boolean).length > 0 ? (
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {[item.tag_name, item.subtag_name].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {item.shared_partner_name ? (
              <div className="text-xs">
                <SharedAccountDisplay
                  account={{
                    id: item.shared_partner_id || 0,
                    name: item.shared_partner_name,
                  }}
                  ownershipPercentage={item.ownership_percentage}
                />
              </div>
            ) : null}
            <p className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
              Parcela {item.current_installment}/{item.total_installments} · {item.remaining_installments} a vencer ·{' '}
              {formatCurrency(item.installment_amount)}/mês · até {item.last_projected_month}
            </p>
          </article>
        </li>
      ))}
    </ul>
  )
}