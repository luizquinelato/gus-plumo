import { useState, useEffect } from 'react'
import { X, Receipt, CreditCard, Gift, ChevronDown, ChevronRight, Calendar, Loader2 } from 'lucide-react'

interface MonthlyDetailItem {
  id: number
  date: string
  description: string
  amount: number
  source_table: string
  tag_name?: string
  subtag_name?: string
  ownership_percentage: number
  my_share: number
  partner_share: number
  year_month?: string
  card_name?: string
  card_number?: string
  card_type?: string
}

interface AccountInfo {
  id: number
  name: string | null
  description: string | null
  bank_name: string | null
}

interface MonthlyDetailsData {
  year: number
  month: number
  month_name: string
  main_account: AccountInfo
  partner_account: AccountInfo
  main_bank_expenses: MonthlyDetailItem[]
  main_bank_revenues: MonthlyDetailItem[]
  main_cc_expenses: MonthlyDetailItem[]
  main_cc_revenues: MonthlyDetailItem[]
  main_benefit_expenses: MonthlyDetailItem[]
  main_benefit_revenues: MonthlyDetailItem[]
  partner_bank_expenses: MonthlyDetailItem[]
  partner_bank_revenues: MonthlyDetailItem[]
  partner_cc_expenses: MonthlyDetailItem[]
  partner_cc_revenues: MonthlyDetailItem[]
  partner_benefit_expenses: MonthlyDetailItem[]
  partner_benefit_revenues: MonthlyDetailItem[]
  main_total_a_receber: number
  main_total_a_pagar: number
  main_net_balance: number
  partner_total_a_receber: number
  partner_total_a_pagar: number
  partner_net_balance: number
}

interface MonthlyHistoryDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  data: MonthlyDetailsData | null
  loading?: boolean
}

// Seção expansível para cada tipo de transação
const TransactionSection = ({
  title,
  icon,
  items,
  colorClass,
  isExpense
}: {
  title: string
  icon: React.ReactNode
  items: MonthlyDetailItem[]
  colorClass: string
  isExpense: boolean
}) => {
  const [isExpanded, setIsExpanded] = useState(true)

  if (items.length === 0) return null

  const total = items.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between p-3 ${colorClass} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          {icon}
          <span className="font-semibold">{title}</span>
          <span className="text-sm opacity-75">({items.length} {items.length === 1 ? 'item' : 'itens'})</span>
        </div>
        <span className={`font-bold ${isExpense ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {isExpense ? '-' : '+'}R$ {total.toFixed(2).replace('.', ',')}
        </span>
      </button>

      {/* Table */}
      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="text-left p-2 font-medium text-gray-600 dark:text-gray-300">Data</th>
                <th className="text-left p-2 font-medium text-gray-600 dark:text-gray-300">Descrição</th>
                <th className="text-left p-2 font-medium text-gray-600 dark:text-gray-300">Categoria</th>
                <th className="text-right p-2 font-medium text-gray-600 dark:text-gray-300">Valor</th>
                <th className="text-center p-2 font-medium text-gray-600 dark:text-gray-300">%</th>
                <th className="text-right p-2 font-medium text-gray-600 dark:text-gray-300">Minha Parte</th>
                <th className="text-right p-2 font-medium text-gray-600 dark:text-gray-300">Parte Parceiro</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.source_table}-${item.id}`} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="p-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {new Date(item.date).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="p-2 text-gray-900 dark:text-white">
                    {item.description}
                    {item.card_name && (
                      <span className="text-xs text-gray-500 ml-2">({item.card_name})</span>
                    )}
                  </td>
                  <td className="p-2 text-gray-500 dark:text-gray-400 text-sm">
                    {item.tag_name ? `${item.tag_name}${item.subtag_name ? ` > ${item.subtag_name}` : ''}` : '-'}
                  </td>
                  <td className={`p-2 text-right font-medium ${isExpense ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {isExpense ? '-' : '+'}R$ {Math.abs(Number(item.amount)).toFixed(2).replace('.', ',')}
                  </td>
                  <td className="p-2 text-center text-gray-600 dark:text-gray-400">
                    {Number(item.ownership_percentage).toFixed(0)}%
                  </td>
                  <td className="p-2 text-right font-medium text-color-primary">
                    R$ {Number(item.my_share).toFixed(2).replace('.', ',')}
                  </td>
                  <td className="p-2 text-right font-medium text-color-secondary">
                    R$ {Number(item.partner_share).toFixed(2).replace('.', ',')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const MonthlyHistoryDetailsModal = ({
  isOpen,
  onClose,
  data,
  loading = false
}: MonthlyHistoryDetailsModalProps) => {
  // Atalho ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-[95vw] xl:max-w-[90vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Calendar size={24} className="text-color-primary" />
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Detalhes de {data?.month_name || 'Mês'} {data?.year || ''}
              </h2>
              {data && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {data.main_account.name} ↔ {data.partner_account.name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-color-primary" />
              <span className="ml-3 text-gray-600 dark:text-gray-400">Carregando detalhes...</span>
            </div>
          ) : !data ? (
            <div className="text-center py-12 text-gray-500">
              Nenhum dado disponível
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Coluna 1: Conta Logada */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-color-primary"></span>
                  {data.main_account.name || 'Conta Principal'}
                </h3>

                {/* Transações Bancárias */}
                <TransactionSection
                  title="Transações Bancárias - Despesas"
                  icon={<Receipt size={16} className="text-color-primary" />}
                  items={data.main_bank_expenses}
                  colorClass="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Transações Bancárias - Receitas"
                  icon={<Receipt size={16} className="text-green-600" />}
                  items={data.main_bank_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Cartões de Crédito */}
                <TransactionSection
                  title="Cartão de Crédito - Despesas"
                  icon={<CreditCard size={16} className="text-purple-600" />}
                  items={data.main_cc_expenses}
                  colorClass="bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Cartão de Crédito - Receitas"
                  icon={<CreditCard size={16} className="text-green-600" />}
                  items={data.main_cc_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Benefícios */}
                <TransactionSection
                  title="Cartão Benefício - Despesas"
                  icon={<Gift size={16} className="text-orange-600" />}
                  items={data.main_benefit_expenses}
                  colorClass="bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Cartão Benefício - Receitas"
                  icon={<Gift size={16} className="text-green-600" />}
                  items={data.main_benefit_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Resumo da Conta Logada */}
                <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">A Receber</div>
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(Number(data.main_total_a_receber))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">A Pagar</div>
                      <div className="text-lg font-bold text-red-600 dark:text-red-400">
                        {formatCurrency(Number(data.main_total_a_pagar))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Saldo</div>
                      <div className={`text-lg font-bold ${Number(data.main_net_balance) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(Number(data.main_net_balance))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Coluna 2: Conta Parceira */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-color-secondary"></span>
                  {data.partner_account.name || 'Conta Parceira'}
                </h3>

                {/* Transações Bancárias */}
                <TransactionSection
                  title="Transações Bancárias - Despesas"
                  icon={<Receipt size={16} className="text-color-secondary" />}
                  items={data.partner_bank_expenses}
                  colorClass="bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Transações Bancárias - Receitas"
                  icon={<Receipt size={16} className="text-green-600" />}
                  items={data.partner_bank_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Cartões de Crédito */}
                <TransactionSection
                  title="Cartão de Crédito - Despesas"
                  icon={<CreditCard size={16} className="text-purple-600" />}
                  items={data.partner_cc_expenses}
                  colorClass="bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Cartão de Crédito - Receitas"
                  icon={<CreditCard size={16} className="text-green-600" />}
                  items={data.partner_cc_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Benefícios */}
                <TransactionSection
                  title="Cartão Benefício - Despesas"
                  icon={<Gift size={16} className="text-orange-600" />}
                  items={data.partner_benefit_expenses}
                  colorClass="bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200"
                  isExpense={true}
                />
                <TransactionSection
                  title="Cartão Benefício - Receitas"
                  icon={<Gift size={16} className="text-green-600" />}
                  items={data.partner_benefit_revenues}
                  colorClass="bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                  isExpense={false}
                />

                {/* Resumo da Conta Parceira */}
                <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">A Receber</div>
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(Number(data.partner_total_a_receber))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">A Pagar</div>
                      <div className="text-lg font-bold text-red-600 dark:text-red-400">
                        {formatCurrency(Number(data.partner_total_a_pagar))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Saldo</div>
                      <div className={`text-lg font-bold ${Number(data.partner_net_balance) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(Number(data.partner_net_balance))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-all font-semibold"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export default MonthlyHistoryDetailsModal

