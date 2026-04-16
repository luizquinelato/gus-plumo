import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface JsonTreeViewerProps {
  data: any
  initialExpanded?: boolean
  expandDepth?: number // Profundidade máxima para expandir (Infinity = tudo)
}

interface JsonNodeProps {
  keyName: string | null
  value: any
  depth: number
  expandDepth: number
  isLast: boolean
}

// Ordem lógica das chaves para o JSON do balanço
const KEY_ORDER: { [key: string]: number } = {
  // Nível raiz
  'calculation_date': 1,
  'year': 2,
  'month': 3,
  'closing_day': 4,
  'start_date': 5,
  'end_date': 6,
  'main_account_card': 7,
  'partner_account_card': 8,
  'loan_payments': 9,

  // Nível da conta (account_card)
  'account_id': 10,
  'account_name': 11,
  'account_number': 12,
  'bank_name': 13,
  'agency': 14,
  'status': 20,
  'total_to_receive': 21,  // Positivo (despesas que EU paguei = a receber)
  'total_to_pay': 22,      // Negativo (despesas do PARCEIRO = a pagar)
  'net_amount_before_loans': 30,
  'loan_to_receive': 31,
  'loan_to_pay': 32,
  'net_amount': 33,
  'expense_items': 40,
  'revenue_items': 41,
  'credit_card_expense_items': 42,
  'credit_card_revenue_items': 43,
  'benefit_card_expense_items': 44,
  'benefit_card_revenue_items': 45,

  // Nível do item
  'id': 1,
  'date': 2,
  'description': 3,
  'original_description': 4,
  'amount': 5,
  'tag_name': 6,
  'subtag_name': 7,
  'my_contribution_percentage': 8,
  'partner_contribution_percentage': 9,
  'card_name': 10,
  'card_type': 11,
  'year_month': 12,
  'card_id': 13,
}

// Função para ordenar as chaves de um objeto
const sortObjectKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortObjectKeys)

  const entries = Object.entries(obj)
  entries.sort(([keyA], [keyB]) => {
    const orderA = KEY_ORDER[keyA] ?? 1000
    const orderB = KEY_ORDER[keyB] ?? 1000
    if (orderA !== orderB) return orderA - orderB
    return keyA.localeCompare(keyB) // Fallback: ordem alfabética
  })

  const sorted: { [key: string]: any } = {}
  for (const [key, value] of entries) {
    sorted[key] = sortObjectKeys(value)
  }
  return sorted
}

const JsonNode = ({ keyName, value, depth, expandDepth, isLast }: JsonNodeProps) => {
  // Expande se a profundidade atual é menor que expandDepth
  const [isExpanded, setIsExpanded] = useState(depth < expandDepth)
  
  const isObject = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const isEmpty = isObject && Object.keys(value).length === 0
  
  const indent = depth * 16

  // Renderizar valor primitivo
  const renderPrimitiveValue = (val: any) => {
    if (val === null) return <span className="text-gray-500">null</span>
    if (typeof val === 'boolean') return <span className="text-purple-400">{val.toString()}</span>
    if (typeof val === 'number') return <span className="text-cyan-400">{val}</span>
    if (typeof val === 'string') return <span className="text-amber-400">"{val}"</span>
    return <span className="text-gray-400">{String(val)}</span>
  }

  // Valor primitivo
  if (!isObject) {
    return (
      <div className="flex items-start" style={{ paddingLeft: indent }}>
        {keyName !== null && (
          <span className="text-blue-300 mr-1">"{keyName}":</span>
        )}
        {renderPrimitiveValue(value)}
        {!isLast && <span className="text-gray-500">,</span>}
      </div>
    )
  }

  // Objeto ou Array vazio
  if (isEmpty) {
    return (
      <div className="flex items-start" style={{ paddingLeft: indent }}>
        {keyName !== null && (
          <span className="text-blue-300 mr-1">"{keyName}":</span>
        )}
        <span className="text-gray-400">{isArray ? '[]' : '{}'}</span>
        {!isLast && <span className="text-gray-500">,</span>}
      </div>
    )
  }

  // Objeto ou Array com conteúdo
  const entries = Object.entries(value)
  const itemCount = entries.length
  const bracket = isArray ? ['[', ']'] : ['{', '}']

  return (
    <div>
      {/* Linha do header (chave + bracket de abertura) */}
      <div 
        className="flex items-center cursor-pointer hover:bg-white/5 rounded"
        style={{ paddingLeft: indent }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-gray-500 mr-1 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-500 mr-1 flex-shrink-0" />
        )}
        {keyName !== null && (
          <span className="text-blue-300 mr-1">"{keyName}":</span>
        )}
        <span className="text-gray-400">{bracket[0]}</span>
        {!isExpanded && (
          <>
            <span className="text-gray-500 text-xs ml-1">
              {itemCount} {isArray ? (itemCount === 1 ? 'item' : 'itens') : (itemCount === 1 ? 'campo' : 'campos')}
            </span>
            <span className="text-gray-400">{bracket[1]}</span>
            {!isLast && <span className="text-gray-500">,</span>}
          </>
        )}
      </div>

      {/* Conteúdo expandido */}
      {isExpanded && (
        <>
          {entries.map(([key, val], index) => (
            <JsonNode
              key={key}
              keyName={isArray ? null : key}
              value={val}
              depth={depth + 1}
              expandDepth={expandDepth}
              isLast={index === entries.length - 1}
            />
          ))}
          <div style={{ paddingLeft: indent }}>
            <span className="text-gray-400 ml-5">{bracket[1]}</span>
            {!isLast && <span className="text-gray-500">,</span>}
          </div>
        </>
      )}
    </div>
  )
}

export const JsonTreeViewer = ({ data, initialExpanded = true, expandDepth }: JsonTreeViewerProps) => {
  // Se expandDepth foi passado, usar esse valor
  // Senão, usar 2 se initialExpanded=true, ou 0 se false
  const effectiveExpandDepth = expandDepth !== undefined
    ? expandDepth
    : (initialExpanded ? 2 : 0)

  // Ordenar as chaves do JSON antes de renderizar
  const sortedData = sortObjectKeys(data)

  return (
    <div className="font-mono text-sm leading-6">
      <JsonNode
        keyName={null}
        value={sortedData}
        depth={0}
        expandDepth={effectiveExpandDepth}
        isLast={true}
      />
    </div>
  )
}

export default JsonTreeViewer

