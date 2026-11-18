import { CreditCard } from 'lucide-react'

export type FaturasMobileItem = {
  id: number
  date: string
  description: string
  amount: number
  tag_name?: string | null
  subtag_name?: string | null
  current_installment?: number | null
  total_installments?: number | null
  shared_partner_name?: string | null
  ownership_percentage?: number | null
}

type Props = {
  items: FaturasMobileItem[]
  formatCurrency: (value: number) => string
  formatDate: (dateStr: string) => string
  mineAmount: (item: FaturasMobileItem) => number
  partnerAmount: (item: FaturasMobileItem) => number
  showSharingSplit: boolean
}

function amountClass(value: number, strong = false): string {
  const w = strong ? 'font-semibold' : 'font-medium'
  if (value >= 0) return `${w} text-green-600 dark:text-green-400`
  return `${w} text-red-600 dark:text-red-400`
}

export default function FaturasMobileItemList({
  items,
  formatCurrency,
  formatDate,
  mineAmount,
  partnerAmount,
  showSharingSplit,
}: Props) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Nenhum lançamento neste cartão.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {items.map((item) => {
        const mine = mineAmount(item)
        const partner = partnerAmount(item)
        const meta = [item.tag_name, item.subtag_name].filter(Boolean).join(' · ')

        return (
          <li key={item.id} className="list-none px-3 py-3">
            <article className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <CreditCard size={16} style={{ color: 'var(--color-2)' }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">
                    {item.description}
                    {item.current_installment && item.total_installments ? (
                      <span className="font-normal text-gray-500 dark:text-gray-400">
                        {' '}
                        · {item.current_installment}/{item.total_installments}x
                      </span>
                    ) : null}
                  </p>
                  <p className={`shrink-0 text-base tabular-nums ${amountClass(Number(item.amount), true)}`}>
                    {formatCurrency(Number(item.amount))}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{formatDate(item.date)}</p>
                {meta ? (
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{meta}</p>
                ) : null}
                {item.shared_partner_name ? (
                  <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    {item.shared_partner_name}
                    {item.ownership_percentage != null ? ` · ${item.ownership_percentage}%` : null}
                  </p>
                ) : null}
                {showSharingSplit && (partner !== 0 || mine !== Number(item.amount)) ? (
                  <p className="mt-1.5 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    Você {formatCurrency(mine)}
                    {partner !== 0 ? ` · Compart. ${formatCurrency(partner)}` : null}
                  </p>
                ) : null}
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}