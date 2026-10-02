import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { CreditCard, ExternalLink, Link2 } from 'lucide-react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import LoadingSpinner from './LoadingSpinner'
import SortableDateHeader from './SortableDateHeader'
import {
  sortRowsByDate,
  toggleDateSortDirection,
  type DateSortDirection,
} from '../utils/tableDateSort'

export interface LinkedInvoiceSummary {
  match_id: number
  year_month: string
  display_name: string
}

interface InvoiceLineItem {
  id: number
  date: string
  description: string
  amount: number
  card_name?: string | null
  card_number?: string | null
  tag_name?: string | null
  subtag_name?: string | null
  current_installment?: number | null
  total_installments?: number | null
}

interface InvoiceDetailResponse {
  year_month: string
  display_name: string
  bank_statement_amount: number | null
  bank_statement_description: string | null
  items_total: number
  items: InvoiceLineItem[]
}

interface LinkedInvoiceItemsModalProps {
  isOpen: boolean
  onClose: () => void
  bankStatementId: number | null
  linkedSummary?: LinkedInvoiceSummary | null
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

export default function LinkedInvoiceItemsModal({
  isOpen,
  onClose,
  bankStatementId,
  linkedSummary,
}: LinkedInvoiceItemsModalProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<InvoiceDetailResponse | null>(null)
  const [dateSortDirection, setDateSortDirection] = useState<DateSortDirection>('desc')

  const sortedItems = useMemo(() => {
    if (!detail?.items?.length) return []
    return sortRowsByDate(
      detail.items,
      (item) => item.date,
      dateSortDirection,
      (a, b) => a.id - b.id,
    )
  }, [detail?.items, dateSortDirection])

  useEffect(() => {
    if (!isOpen || bankStatementId == null) {
      setDetail(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    axios
      .get<InvoiceDetailResponse>(`/api/invoice-payment-matches/by-bank-statement/${bankStatementId}`)
      .then((response) => {
        if (!cancelled) setDetail(response.data)
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = axios.isAxiosError(err)
            ? err.response?.data?.detail || err.message
            : 'Erro ao carregar itens da fatura'
          setError(typeof msg === 'string' ? msg : 'Erro ao carregar itens da fatura')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, bankStatementId])

  if (!isOpen) return null

  const titleName = detail?.display_name || linkedSummary?.display_name || 'Fatura vinculada'
  const yearMonth = detail?.year_month || linkedSummary?.year_month

  return (
    <CadastroModalShell maxWidth="max-w-4xl" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        icon={<Link2 className="w-5 h-5" />}
        title="Itens da fatura vinculada"
        subtitle={
          yearMonth
            ? `${titleName} · competência ${yearMonth.split('-').reverse().join('/')}`
            : titleName
        }
        onClose={onClose}
      />
      <CadastroModalBody scrollable>
        {loading && <LoadingSpinner message="Carregando itens..." />}
        {!loading && error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {!loading && !error && detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Lançamento no extrato</p>
                <p className="font-medium text-gray-900 dark:text-white truncate" title={detail.bank_statement_description || undefined}>
                  {detail.bank_statement_description || '—'}
                </p>
                <p className={`mt-1 font-semibold ${(detail.bank_statement_amount ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {detail.bank_statement_amount != null ? formatCurrency(detail.bank_statement_amount) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Soma dos itens da fatura</p>
                <p className={`font-semibold ${detail.items_total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(detail.items_total)}
                </p>
                {detail.bank_statement_amount != null &&
                  Math.abs(detail.items_total - detail.bank_statement_amount) > 0.02 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                      O valor do extrato pode incluir juros, IOF ou arredondamentos não listados item a item.
                    </p>
                  )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/80">
                  <tr>
                    <SortableDateHeader
                      sortDirection={dateSortDirection}
                      onToggle={() =>
                        setDateSortDirection(toggleDateSortDirection(dateSortDirection))
                      }
                      className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300"
                    />
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Descrição</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Cartão</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Tag</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                        Nenhum item encontrado para este ciclo.
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((item) => (
                      <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-900 dark:text-white">
                          {formatDateTime(item.date)}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white max-w-xs truncate" title={item.description}>
                          {item.description}
                          {item.current_installment && item.total_installments ? (
                            <span className="text-xs text-gray-500 ml-1">
                              {item.current_installment}/{item.total_installments}x
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                          {item.card_name ? (
                            <span className="inline-flex items-center gap-1">
                              <CreditCard size={14} />
                              {item.card_name}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300 truncate">
                          {item.tag_name || '—'}
                          {item.subtag_name ? ` / ${item.subtag_name}` : ''}
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${item.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        hideSave
        closeLabel="Fechar"
        secondaryActions={
          yearMonth ? (
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/relatorios/faturas', { state: { yearMonth, selectAllCards: true } })
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-color-primary hover:bg-color-primary-light rounded-lg transition-colors"
            >
              <ExternalLink size={16} />
              Abrir em Faturas
            </button>
          ) : undefined
        }
      />
    </CadastroModalShell>
  )
}
