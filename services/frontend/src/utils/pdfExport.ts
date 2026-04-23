import jsPDF from 'jspdf'
import autoTableLib from 'jspdf-autotable'

// Wrapper para suprimir warnings do autoTable sobre largura de tabela
const autoTable = (doc: jsPDF, options: Parameters<typeof autoTableLib>[1]) => {
  const originalWarn = console.warn
  console.warn = (...args: any[]) => {
    const message = args[0]?.toString() || ''
    if (!message.includes('could not fit page')) {
      originalWarn.apply(console, args)
    }
  }
  try {
    autoTableLib(doc, options)
  } finally {
    console.warn = originalWarn
  }
}

interface TransactionItem {
  id: number
  date: string
  description: string
  amount: number
  tag_name?: string | null
  subtag_name?: string | null
  my_contribution_percentage: number
  partner_contribution_percentage: number
  year_month?: string
  card_name?: string
  card_number?: string
}

interface AccountBalanceCard {
  account_id: number
  account_name: string
  bank_name: string | null
  agency: string | null
  account_number: number | string | null
  total_expenses: number
  total_revenues: number
  net_amount: number
  contribution_percentage: number
  expense_items: TransactionItem[]
  revenue_items: TransactionItem[]
  credit_card_expense_items: TransactionItem[]
  credit_card_revenue_items: TransactionItem[]
  benefit_card_expense_items: TransactionItem[]
  benefit_card_revenue_items: TransactionItem[]
}

interface LoanPaymentItem {
  loan_id: number
  loan_type: 'lent' | 'borrowed'
  description: string
  original_amount: number
  remaining_before: number
  amount_paid: number
  remaining_after: number
  is_settled?: boolean
}

interface ClosurePaymentItem {
  id: number
  amount: number
  payment_date: string
  notes: string | null
}

interface BalanceClosure {
  id: number
  period_start_date: string
  closing_date: string
  year: number
  month: number
  total_to_receive: number
  total_to_pay: number
  net_balance: number
  is_settled?: boolean
  total_paid?: number
  remaining_balance?: number
  notes: string | null
  closure_payments?: ClosurePaymentItem[]
  closure_data: {
    main_account_card: AccountBalanceCard
    partner_account_card: AccountBalanceCard
    loan_payments?: LoanPaymentItem[]
  }
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr)
  const datePart = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  const timePart = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  })
  // Retorna data e hora separados por espaço (sem vírgula, sem segundos)
  return `${datePart} ${timePart}`
}

const getMonthName = (month: number): string => {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return months[month - 1] || ''
}

// Função auxiliar para formatar agência com máscara (xxxxx-0)
const formatAgencyMask = (agency: string | null): string => {
  if (!agency) return ''
  const agencyStr = String(agency).padStart(5, '0')
  return `${agencyStr}-0`
}

// Função auxiliar para formatar número da conta com máscara (xxxxxxxxx-6)
const formatAccountMask = (accountNumber: number | string | null): string => {
  if (!accountNumber) return ''
  const accountStr = String(accountNumber).padStart(9, '0')
  return `${accountStr}-6`
}

// Função auxiliar para formatar informações da conta
const formatAccountInfo = (card: AccountBalanceCard): string => {
  const parts: string[] = []
  if (card.account_name) parts.push(card.account_name)
  if (card.bank_name) parts.push(card.bank_name)
  if (card.agency) parts.push(`Ag: ${formatAgencyMask(card.agency)}`)
  if (card.account_number) parts.push(`Conta: ${formatAccountMask(card.account_number)}`)
  return parts.join(' | ')
}

// Cores das seções (RGB) - Baseadas nas variáveis CSS do sistema
// Estas cores são os fallbacks definidos em index.css
const SECTION_COLORS = {
  transactions: [40, 98, 235] as [number, number, number],   // --color-1: Azul #2862EB
  creditCards: [118, 61, 237] as [number, number, number],   // --color-2: Roxo #763DED
  benefits: [5, 150, 105] as [number, number, number],       // --color-3: Verde #059669
  loans: [217, 119, 6] as [number, number, number],          // Amber #D97706 (amber-600)
  payments: [14, 165, 233] as [number, number, number]       // --color-4: Cyan #0EA5E9
}

// Função para obter cores do CSS (se disponível) ou usar fallback
const getSystemColor = (colorVar: string, fallback: [number, number, number]): [number, number, number] => {
  if (typeof window === 'undefined') return fallback

  const root = document.documentElement
  const cssColor = getComputedStyle(root).getPropertyValue(colorVar).trim()

  if (!cssColor) return fallback

  // Converter hex para RGB
  const hex = cssColor.replace('#', '')
  if (hex.length === 6) {
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16)
    ]
  }

  return fallback
}

// Constante para altura do cabeçalho completo (plataforma + info do fechamento)
// Estrutura: margem(12) + nome(5) + subtítulo(3) + divisor + datas(6) + título(8) = ~48
const HEADER_HEIGHT = 48

// Interface para dados do cabeçalho do fechamento
interface ClosureHeaderData {
  title: string
  periodStart: string
  periodEnd: string
  generatedAt: string
}

// Função para desenhar ícone de pena (feather) - símbolo da plataforma
const drawFeatherIcon = (doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]): void => {
  doc.setDrawColor(color[0], color[1], color[2])
  doc.setFillColor(color[0], color[1], color[2])
  doc.setLineWidth(0.3)

  // Desenhar pena estilizada usando linhas e curvas simples
  const scale = size / 10

  // Haste central da pena (diagonal)
  doc.line(x, y + 8 * scale, x + 6 * scale, y)

  // Parte superior da pena (curva direita)
  doc.line(x + 6 * scale, y, x + 5 * scale, y + 2 * scale)
  doc.line(x + 5 * scale, y + 2 * scale, x + 4 * scale, y + 3 * scale)

  // Parte superior da pena (curva esquerda)
  doc.line(x + 6 * scale, y, x + 4 * scale, y + 1 * scale)

  // Barbas da pena (linhas diagonais saindo da haste)
  doc.line(x + 1 * scale, y + 7 * scale, x + 3 * scale, y + 5 * scale)
  doc.line(x + 2 * scale, y + 6 * scale, x + 4 * scale, y + 4 * scale)
  doc.line(x + 3 * scale, y + 5 * scale, x + 5 * scale, y + 3 * scale)
  doc.line(x + 4 * scale, y + 4 * scale, x + 5.5 * scale, y + 2 * scale)

  // Barbas do lado esquerdo
  doc.line(x + 0.5 * scale, y + 7.5 * scale, x + 2 * scale, y + 6.5 * scale)
  doc.line(x + 1.5 * scale, y + 6.5 * scale, x + 3 * scale, y + 5.5 * scale)
  doc.line(x + 2.5 * scale, y + 5.5 * scale, x + 4 * scale, y + 4.5 * scale)
}

// Função para adicionar cabeçalho temático da plataforma + info do fechamento (em uma página específica)
const addPlatformHeader = (doc: jsPDF, pageNumber?: number, closureData?: ClosureHeaderData): void => {
  const pageWidth = doc.internal.pageSize.getWidth()
  const primaryColor = getSystemColor('--color-1', SECTION_COLORS.transactions)
  const color2Header = getSystemColor('--color-2', [118, 61, 237])

  // Se pageNumber fornecido, ir para essa página
  if (pageNumber) {
    doc.setPage(pageNumber)
  }

  // Margem superior
  let yPos = 12

  // Nome da plataforma centralizado
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  const platformName = 'PLUMO'
  const platformNameWidth = doc.getTextWidth(platformName)
  const iconSize = 10
  const iconGap = 3

  // Calcular posição X para o nome ficar centralizado
  const nameX = pageWidth / 2
  // Ícone fica à esquerda do nome centralizado
  const iconX = nameX - (platformNameWidth / 2) - iconGap - iconSize

  // Desenhar ícone da pena à esquerda do nome
  drawFeatherIcon(doc, iconX, yPos - 6, iconSize, primaryColor)

  // Nome da plataforma (centralizado)
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2])
  doc.text(platformName, nameX, yPos, { align: 'center' })

  // Subtítulo (centralizado)
  yPos += 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text('Finanças leves, vida plena', pageWidth / 2, yPos, { align: 'center' })

  // Linha azul separadora
  yPos += 3
  doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2])
  doc.setLineWidth(1)
  doc.line(14, yPos, pageWidth - 14, yPos)

  // Se tiver dados do fechamento, adicionar datas e título abaixo da linha
  if (closureData) {
    // Margem acima das datas (logo após o divisor)
    yPos += 6

    // Período e Gerado em na mesma linha (logo abaixo do divisor)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)

    // Lado esquerdo: Período
    const periodText = `Período: `
    doc.text(periodText, 14, yPos)
    const periodTextWidth = doc.getTextWidth(periodText)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2])
    doc.text(closureData.periodStart, 14 + periodTextWidth, yPos)
    const periodStartWidth = doc.getTextWidth(closureData.periodStart)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    doc.text(' até ', 14 + periodTextWidth + periodStartWidth, yPos)
    const ateWidth = doc.getTextWidth(' até ')
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2])
    doc.text(closureData.periodEnd, 14 + periodTextWidth + periodStartWidth + ateWidth, yPos)

    // Lado direito: Gerado em
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    const geradoText = `Gerado em: `
    const geradoTextWidth = doc.getTextWidth(geradoText)
    const geradoDateWidth = doc.getTextWidth(closureData.generatedAt)
    const geradoStartX = pageWidth - 14 - geradoTextWidth - geradoDateWidth
    doc.text(geradoText, geradoStartX, yPos)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(color2Header[0], color2Header[1], color2Header[2])
    doc.text(closureData.generatedAt, geradoStartX + geradoTextWidth, yPos)

    // Espaço entre datas e título
    yPos += 8

    // Título do fechamento (grande, centralizado)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    doc.text(closureData.title, pageWidth / 2, yPos, { align: 'center' })
  }

  // Reset cor do texto
  doc.setTextColor(0, 0, 0)
}

// Função para adicionar cabeçalho em todas as páginas do documento
const addHeaderToAllPages = (doc: jsPDF, closureData?: ClosureHeaderData): void => {
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    addPlatformHeader(doc, i, closureData)
  }
}

// Função auxiliar para adicionar divisor de seção
const addSectionDivider = (doc: jsPDF, title: string, color: [number, number, number]): void => {
  let yPos = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 15 : HEADER_HEIGHT + 6

  // Check if we need a new page (deixar espaço para o cabeçalho)
  if (yPos > 260) {
    doc.addPage()
    yPos = HEADER_HEIGHT + 6  // Margem após cabeçalho
  }

  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(color[0], color[1], color[2])

  // Linha antes do título
  doc.setDrawColor(color[0], color[1], color[2])
  doc.setLineWidth(0.5)
  doc.line(14, yPos, pageWidth - 14, yPos)
  yPos += 6

  // Título centralizado (sem ícone - jsPDF não suporta)
  doc.text(title, pageWidth / 2, yPos, { align: 'center' })
  yPos += 4

  // Linha depois do título
  doc.line(14, yPos, pageWidth - 14, yPos)

  // Reset text color
  doc.setTextColor(0, 0, 0)

  // Atualizar lastAutoTable.finalY para que as próximas tabelas comecem após o divisor
  ;(doc as any).lastAutoTable = { finalY: yPos + 2 }
}

export const exportBalanceClosureToPDF = (closure: BalanceClosure, isCounterpart: boolean = false, absoluteValues: boolean = false): void => {
  const doc = new jsPDF()

  const mainCard = closure.closure_data?.main_account_card
  const partnerCard = closure.closure_data?.partner_account_card

  if (!mainCard || !partnerCard) {
    console.error('Dados de closure incompletos')
    return
  }

  // Preparar dados do cabeçalho para todas as páginas
  const now = new Date()
  const geradoDatePart = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const geradoTimePart = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const closureHeaderData: ClosureHeaderData = {
    title: `Fechamento de Balanço`,
    periodStart: formatDateTime(closure.period_start_date),
    periodEnd: formatDateTime(closure.closing_date),
    generatedAt: `${geradoDatePart} ${geradoTimePart}`
  }

  // Posição inicial após área do cabeçalho completo
  let yPos = HEADER_HEIGHT

  // --- DADOS DAS CONTAS (tabela alinhada) ---
  // Para contraparte: inverter a ordem (quem está gerando aparece como "Principal")
  const viewerCard = isCounterpart ? partnerCard : mainCard
  const otherCard = isCounterpart ? mainCard : partnerCard

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Contas do Fechamento', 14, yPos)
  yPos += 6

  // Obter cor do header do sistema
  const accountsHeaderColor = getSystemColor('--color-1', [40, 98, 235])

  const accountsData = [
    ['', 'Nome', 'Banco', 'Agência', 'Conta'],
    ['Principal', viewerCard.account_name || '-', viewerCard.bank_name || '-', viewerCard.agency ? formatAgencyMask(viewerCard.agency) : '-', viewerCard.account_number ? formatAccountMask(viewerCard.account_number) : '-'],
    ['Contraparte', otherCard.account_name || '-', otherCard.bank_name || '-', otherCard.agency ? formatAgencyMask(otherCard.agency) : '-', otherCard.account_number ? formatAccountMask(otherCard.account_number) : '-']
  ]

  autoTable(doc, {
    startY: yPos,
    head: [accountsData[0]],
    body: accountsData.slice(1),
    theme: 'striped',
    headStyles: { fillColor: accountsHeaderColor, textColor: 255, fontStyle: 'bold', halign: 'left' },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' },
      1: { halign: 'left' },
      2: { halign: 'left' },
      3: { halign: 'center' },
      4: { halign: 'center' }
    }
  })

  yPos = (doc as any).lastAutoTable.finalY + 15

  // --- RESUMO ---
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumo', 14, yPos)
  yPos += 6

  // IMPORTANTE: Converter para número caso venha como string do JSON
  const parseNumeric = (value: any): number => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') return parseFloat(value) || 0
    return 0
  }

  // Cada card (main e partner) tem seus próprios valores de A Receber/A Pagar
  // A conta logada deve ver os valores do SEU card

  // Valores do viewer (quem está gerando o PDF)
  const viewerTotalToReceive = parseNumeric(viewerCard.total_to_receive)
  const viewerLoanToReceive = parseNumeric(viewerCard.loan_to_receive)
  const viewerToReceive = viewerTotalToReceive + viewerLoanToReceive

  const viewerTotalToPay = Math.abs(parseNumeric(viewerCard.total_to_pay))
  const viewerLoanToPay = Math.abs(parseNumeric(viewerCard.loan_to_pay))
  const viewerToPay = viewerTotalToPay + viewerLoanToPay

  const viewerNetBalance = viewerToReceive - viewerToPay

  // Valores da outra parte
  const otherTotalToReceive = parseNumeric(otherCard.total_to_receive)
  const otherLoanToReceive = parseNumeric(otherCard.loan_to_receive)
  const otherToReceive = otherTotalToReceive + otherLoanToReceive

  const otherTotalToPay = Math.abs(parseNumeric(otherCard.total_to_pay))
  const otherLoanToPay = Math.abs(parseNumeric(otherCard.loan_to_pay))
  const otherToPay = otherTotalToPay + otherLoanToPay

  const otherNetBalance = otherToReceive - otherToPay

  const formatToPay = (value: number): string => {
    if (absoluteValues) return value > 0 ? formatCurrency(value) : formatCurrency(0)
    return value > 0 ? `-${formatCurrency(value)}` : formatCurrency(0)
  }

  // Pre-computed numeric values for summary coloring (independent of text format)
  const summaryNumericValues = [
    { toReceive: viewerToReceive, toPay: viewerToPay, net: viewerNetBalance },
    { toReceive: otherToReceive, toPay: otherToPay, net: otherNetBalance }
  ]

  const formatNetBalance = (value: number): string =>
    absoluteValues ? formatCurrency(Math.abs(value)) : formatCurrency(value)

  const summaryData = [
    ['Conta', 'Total a Receber', 'Total a Pagar', 'Saldo'],
    [viewerCard.account_name, formatCurrency(viewerToReceive), formatToPay(viewerToPay), formatNetBalance(viewerNetBalance)],
    [otherCard.account_name, formatCurrency(otherToReceive), formatToPay(otherToPay), formatNetBalance(otherNetBalance)]
  ]

  // Obter cor do header do sistema (color-2 para diferenciar da tabela de contas)
  const summaryHeaderColor = getSystemColor('--color-2', [118, 61, 237])

  autoTable(doc, {
    startY: yPos,
    head: [summaryData[0]],
    body: summaryData.slice(1),
    theme: 'striped',
    headStyles: { fillColor: summaryHeaderColor, textColor: 255, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' }
    },
    // Aplicar cores condicionais nas células (baseado em valores numéricos, não texto)
    didParseCell: (data) => {
      // Centralizar header
      if (data.section === 'head' && data.column.index > 0) {
        data.cell.styles.halign = 'center'
      }
      if (data.section === 'body') {
        const rowValues = summaryNumericValues[data.row.index]
        if (!rowValues) return
        // Coluna 1: Total a Receber (verde se > 0)
        if (data.column.index === 1 && rowValues.toReceive > 0) {
          data.cell.styles.textColor = greenColor
        }
        // Coluna 2: Total a Pagar (vermelho se há valor a pagar)
        if (data.column.index === 2 && rowValues.toPay > 0) {
          data.cell.styles.textColor = redColor
        }
        // Coluna 3: Saldo (verde se positivo, vermelho se negativo)
        if (data.column.index === 3) {
          if (rowValues.net < 0) data.cell.styles.textColor = redColor
          else if (rowValues.net > 0) data.cell.styles.textColor = greenColor
        }
      }
    }
  })

  yPos = (doc as any).lastAutoTable.finalY + 8

  // --- SALDO FINAL ---
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  let balanceText = ''
  // viewerNetBalance positivo = viewer tem a receber = outra parte deve pagar
  // viewerNetBalance negativo = viewer tem a pagar = viewer deve pagar
  if (viewerNetBalance > 0) {
    balanceText = `${otherCard.account_name} deve pagar ${formatCurrency(viewerNetBalance)} para ${viewerCard.account_name}`
  } else if (viewerNetBalance < 0) {
    balanceText = `${viewerCard.account_name} deve pagar ${formatCurrency(Math.abs(viewerNetBalance))} para ${otherCard.account_name}`
  } else {
    balanceText = 'Contas zeradas - nenhum pagamento necessario'
  }
  doc.text(balanceText, 14, yPos)

  // Atualizar lastAutoTable para próximas seções
  ;(doc as any).lastAutoTable = { finalY: yPos + 5 }

  // Obter cores do sistema (dinâmicas ou fallback) - color1 já foi declarada acima
  const sectionColor1 = getSystemColor('--color-1', SECTION_COLORS.transactions)
  const color2 = getSystemColor('--color-2', SECTION_COLORS.creditCards)
  const color3 = getSystemColor('--color-3', SECTION_COLORS.benefits)

  // --- SEÇÃO: TRANSAÇÕES BANCÁRIAS ---
  const mainBankItems = [...(mainCard.expense_items || []), ...(mainCard.revenue_items || [])]
  const partnerBankItems = [...(partnerCard.expense_items || []), ...(partnerCard.revenue_items || [])]

  if (mainBankItems.length > 0 || partnerBankItems.length > 0) {
    addSectionDivider(doc, 'TRANSAÇÕES BANCÁRIAS', sectionColor1)
    addTransactionTable(doc, mainCard.account_name, mainBankItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
    addTransactionTable(doc, partnerCard.account_name, partnerBankItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
  }

  // --- SEÇÃO: CARTÕES DE CRÉDITO ---
  const mainCardItems = [...(mainCard.credit_card_expense_items || []), ...(mainCard.credit_card_revenue_items || [])]
  const partnerCardItems = [...(partnerCard.credit_card_expense_items || []), ...(partnerCard.credit_card_revenue_items || [])]

  if (mainCardItems.length > 0 || partnerCardItems.length > 0) {
    addSectionDivider(doc, 'CARTÕES DE CRÉDITO', color2)
    addCreditCardTable(doc, mainCard.account_name, mainCardItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
    addCreditCardTable(doc, partnerCard.account_name, partnerCardItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
  }

  // --- SEÇÃO: BENEFÍCIOS ---
  // IMPORTANTE: Apenas despesas (amount < 0) são incluídas no balanço de benefícios
  // Receitas de benefícios (estornos) NÃO entram no cálculo de balanço
  const mainBenefitItems = [...(mainCard.benefit_card_expense_items || [])]
  const partnerBenefitItems = [...(partnerCard.benefit_card_expense_items || [])]

  if (mainBenefitItems.length > 0 || partnerBenefitItems.length > 0) {
    addSectionDivider(doc, 'CARTÕES DE BENEFÍCIOS', color3)
    addBenefitCardTable(doc, mainCard.account_name, mainBenefitItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
    addBenefitCardTable(doc, partnerCard.account_name, partnerBenefitItems, mainCard.account_name, partnerCard.account_name, absoluteValues)
  }

  // --- SEÇÃO: EMPRÉSTIMOS LIQUIDADOS ---
  const loanPayments = closure.closure_data.loan_payments || []
  if (loanPayments.length > 0) {
    const loanColor = SECTION_COLORS.loans
    addSectionDivider(doc, 'EMPRÉSTIMOS LIQUIDADOS', loanColor)
    addLoanPaymentsTable(doc, loanPayments, mainCard.account_name, absoluteValues)
  }

  // --- SEÇÃO: PAGAMENTOS PARCIAIS ---
  const closurePayments = closure.closure_payments || []
  if (closurePayments.length > 0) {
    addSectionDivider(doc, 'PAGAMENTOS PARCIAIS', SECTION_COLORS.payments)
    const rawNet = parseNumeric(closure.net_balance)          // sinal real do fechamento
    const netAbs = Math.abs(rawNet)
    addClosurePaymentsTable(doc, closurePayments, {
      netBalance: rawNet,                                      // com sinal real
      totalPaid: parseNumeric(closure.total_paid ?? 0),
      remainingAbs: parseNumeric(closure.remaining_balance ?? netAbs),  // sempre positivo (magnitude)
      isSettled: closure.is_settled ?? false,
    }, absoluteValues)
  }

  // Adicionar cabeçalho temático em todas as páginas
  addHeaderToAllPages(doc, closureHeaderData)

  // Adicionar números de página no rodapé (canto inferior direito)
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(8)
    doc.setTextColor(128, 128, 128) // Cinza
    const pageText = `${i} de ${totalPages}`
    doc.text(pageText, pageWidth - 15, pageHeight - 10, { align: 'right' })
  }

  // Save PDF
  // Sanitizar nomes das contas para uso no nome do arquivo (remover caracteres especiais)
  const sanitizeFileName = (name: string): string => {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^a-zA-Z0-9]/g, '_')   // Substitui caracteres especiais por _
      .replace(/_+/g, '_')              // Remove underscores duplicados
      .replace(/^_|_$/g, '')            // Remove underscores no início/fim
      .toLowerCase()
  }

  // Formatar data para nome do arquivo (dd-mm-yyyy, sem horas)
  const formatDateForFileName = (dateStr: string): string => {
    const date = new Date(dateStr)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}-${month}-${year}`
  }

  const mainAccountName = sanitizeFileName(mainCard.account_name || 'principal')
  const partnerAccountName = sanitizeFileName(partnerCard.account_name || 'parceira')
  const periodStart = formatDateForFileName(closure.period_start_date)
  const periodEnd = formatDateForFileName(closure.closing_date)
  const fileName = `fechamento_${mainAccountName}_${partnerAccountName}_${periodStart}_a_${periodEnd}.pdf`
  doc.save(fileName)
}

// Função auxiliar para sanitizar texto para PDF (remove caracteres especiais problemáticos)
const sanitizeText = (text: string): string => {
  if (!text) return ''
  // Remove caracteres não-ASCII problemáticos e normaliza
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^\x20-\x7E]/g, '')    // Remove caracteres não-ASCII
    .trim()
}

// Cores para valores (RGB)
const greenColor: [number, number, number] = [22, 163, 74]   // Verde #16A34A (green-600)
const redColor: [number, number, number] = [220, 38, 38]     // Vermelho #DC2626 (red-600)

// Função auxiliar para formatar valor com sinal (0 não tem sinal negativo)
const formatValueWithSign = (value: number, isExpense: boolean, absoluteValues: boolean = false): string => {
  if (value === 0) return formatCurrency(0)
  if (absoluteValues) return formatCurrency(Math.abs(value))
  return (isExpense ? '-' : '+') + formatCurrency(Math.abs(value))
}

// Função auxiliar para adicionar tabela de transações
const addTransactionTable = (doc: jsPDF, title: string, items: TransactionItem[], mainAccountName?: string, partnerAccountName?: string, absoluteValues: boolean = false): void => {
  if (!items || items.length === 0) return

  let yPos = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 12 : HEADER_HEIGHT + 6

  // Check if we need a new page (deixar espaço para o cabeçalho)
  if (yPos > 250) {
    doc.addPage()
    yPos = HEADER_HEIGHT + 6
  }

  // Sanitizar título para evitar caracteres problemáticos
  const cleanTitle = sanitizeText(title)

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(cleanTitle, 14, yPos)
  yPos += 5

  // Pre-compute sign info per row for numeric-based coloring (independent of formatted text)
  const itemSigns: boolean[] = []  // true = expense (negative), false = revenue (positive)

  const tableData = items.map(item => {
    // Garantir que os valores são números (podem vir como string do JSON)
    const amount = typeof item.amount === 'string' ? parseFloat(item.amount) : (item.amount || 0)
    const myPct = typeof item.my_contribution_percentage === 'string'
      ? parseFloat(item.my_contribution_percentage)
      : (item.my_contribution_percentage || 0)
    const partnerPct = typeof item.partner_contribution_percentage === 'string'
      ? parseFloat(item.partner_contribution_percentage)
      : (item.partner_contribution_percentage || 0)

    const myValue = Math.abs(amount) * (myPct / 100)
    const partnerValue = Math.abs(amount) * (partnerPct / 100)
    const isExpense = amount < 0
    itemSigns.push(isExpense)

    // Sanitizar descrição e categoria
    const cleanDescription = sanitizeText(item.description || '')
    const truncatedDesc = cleanDescription.substring(0, 35) + (cleanDescription.length > 35 ? '...' : '')
    const cleanTag = item.tag_name ? sanitizeText(item.tag_name) : ''
    const cleanSubtag = item.subtag_name ? sanitizeText(item.subtag_name) : ''
    const category = cleanTag ? `${cleanTag}${cleanSubtag ? ' > ' + cleanSubtag : ''}` : '-'

    return [
      formatDate(item.date),
      truncatedDesc,
      category,
      formatValueWithSign(amount, isExpense, absoluteValues),
      formatValueWithSign(myValue, isExpense, absoluteValues),
      formatValueWithSign(partnerValue, isExpense, absoluteValues)
    ]
  })

  // Calculate totals (soma algébrica - despesas são negativas)
  // Garantir conversão para número para evitar NaN
  const totalAmount = items.reduce((sum, item) => {
    const amount = typeof item.amount === 'string' ? parseFloat(item.amount) : (item.amount || 0)
    return sum + amount
  }, 0)

  const totalMyValue = items.reduce((sum, item) => {
    const amount = typeof item.amount === 'string' ? parseFloat(item.amount) : (item.amount || 0)
    const myPct = typeof item.my_contribution_percentage === 'string'
      ? parseFloat(item.my_contribution_percentage)
      : (item.my_contribution_percentage || 0)
    return sum + amount * (myPct / 100)
  }, 0)

  const totalPartnerValue = items.reduce((sum, item) => {
    const amount = typeof item.amount === 'string' ? parseFloat(item.amount) : (item.amount || 0)
    const partnerPct = typeof item.partner_contribution_percentage === 'string'
      ? parseFloat(item.partner_contribution_percentage)
      : (item.partner_contribution_percentage || 0)
    return sum + amount * (partnerPct / 100)
  }, 0)

  // Formatar totais com sinal correto
  const formatTotal = (value: number): string => {
    if (isNaN(value) || value === 0) return formatCurrency(0)
    if (absoluteValues) return formatCurrency(Math.abs(value))
    return (value < 0 ? '-' : '+') + formatCurrency(Math.abs(value))
  }

  // Largura igual ao divisor: pageWidth - 28 (margem 14 de cada lado)
  const pageWidth = doc.internal.pageSize.getWidth()
  const tableWidth = pageWidth - 28  // 182mm em A4

  autoTable(doc, {
    startY: yPos,
    margin: { top: HEADER_HEIGHT, left: 14, right: 14 },
    tableWidth: tableWidth,
    head: [['Data', 'Descrição', 'Categoria', 'Valor', mainAccountName || 'Principal', partnerAccountName || 'Contraparte']],
    body: tableData,
    foot: [['TOTAL', '', '', formatTotal(totalAmount), formatTotal(totalMyValue), formatTotal(totalPartnerValue)]],
    showFoot: 'lastPage',
    theme: 'plain',
    headStyles: {
      fillColor: [100, 100, 100],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    footStyles: {
      fillColor: [255, 250, 205],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineWidth: 0.1,
      lineColor: [200, 200, 200]
    },
    columnStyles: {
      0: { cellWidth: 18 },       // Data
      1: { cellWidth: 'auto' },   // Descrição (flex)
      2: { cellWidth: 28 },       // Categoria
      3: { halign: 'right', cellWidth: 28 },  // Valor
      4: { halign: 'right', cellWidth: 28 },  // Conta Principal
      5: { halign: 'right', cellWidth: 28 }   // Contraparte
    },
    // Aplicar cores alternadas mais visíveis e cores nos valores (baseado em sinais numéricos)
    didParseCell: (data) => {
      // Cores alternadas para linhas do body (mais contraste)
      if (data.section === 'body') {
        if (data.row.index % 2 === 0) {
          data.cell.styles.fillColor = [255, 255, 255]  // Branco
        } else {
          data.cell.styles.fillColor = [240, 240, 240]  // Cinza claro (mais visível)
        }

        // Colunas de valores: vermelho para despesa, verde para receita
        // Usa itemSigns (pré-computado do valor original) – independente de sinal no texto
        if (data.column.index === 3 || data.column.index === 4 || data.column.index === 5) {
          const isExpense = itemSigns[data.row.index]
          if (isExpense === true) {
            data.cell.styles.textColor = redColor
          } else if (isExpense === false) {
            data.cell.styles.textColor = greenColor
          }
        }
      }
      // Alinhamento e cores nos totais do footer (baseado nos totais numéricos)
      if (data.section === 'foot') {
        if (data.column.index === 3 || data.column.index === 4 || data.column.index === 5) {
          data.cell.styles.halign = 'right'
          const footerTotals = [null, null, null, totalAmount, totalMyValue, totalPartnerValue]
          const total = footerTotals[data.column.index]
          if (total !== null && total < 0) data.cell.styles.textColor = redColor
          else if (total !== null && total > 0) data.cell.styles.textColor = greenColor
        }
      }
    }
  })
}

// Função auxiliar para adicionar tabela de cartão de crédito (agrupado por cartão)
const addCreditCardTable = (doc: jsPDF, accountName: string, items: TransactionItem[], mainAccountName?: string, partnerAccountName?: string, absoluteValues: boolean = false): void => {
  if (!items || items.length === 0) return

  // Agrupa por cartão
  const groupedByCard: Record<string, TransactionItem[]> = {}
  items.forEach(item => {
    const cardKey = item.card_name || 'Sem Cartao'
    if (!groupedByCard[cardKey]) groupedByCard[cardKey] = []
    groupedByCard[cardKey].push(item)
  })

  // Para cada cartão, adiciona uma tabela
  Object.entries(groupedByCard).forEach(([cardName, cardItems]) => {
    const cardNumber = cardItems[0]?.card_number || ''
    const lastFour = cardNumber ? cardNumber.slice(-4) : ''
    // Título limpo: "Nome do Cartão (****1234)" - sem nome da conta
    const cleanCardName = sanitizeText(cardName)
    const fullTitle = `${cleanCardName}${lastFour ? ` (****${lastFour})` : ''}`
    addTransactionTable(doc, fullTitle, cardItems, mainAccountName, partnerAccountName, absoluteValues)
  })
}

// Função auxiliar para adicionar tabela de cartão de benefícios (agrupado por cartão)
const addBenefitCardTable = (doc: jsPDF, accountName: string, items: TransactionItem[], mainAccountName?: string, partnerAccountName?: string, absoluteValues: boolean = false): void => {
  if (!items || items.length === 0) return

  // Agrupa por cartão
  const groupedByCard: Record<string, TransactionItem[]> = {}
  items.forEach(item => {
    const cardKey = item.card_name || 'Sem Cartao'
    if (!groupedByCard[cardKey]) groupedByCard[cardKey] = []
    groupedByCard[cardKey].push(item)
  })

  // Para cada cartão, adiciona uma tabela
  Object.entries(groupedByCard).forEach(([cardName, cardItems]) => {
    const cardNumber = cardItems[0]?.card_number || ''
    const lastFour = cardNumber ? cardNumber.slice(-4) : ''
    // Título limpo: "Nome do Cartão (****1234)" - sem nome da conta
    const cleanCardName = sanitizeText(cardName)
    const fullTitle = `${cleanCardName}${lastFour ? ` (****${lastFour})` : ''}`
    addTransactionTable(doc, fullTitle, cardItems, mainAccountName, partnerAccountName, absoluteValues)
  })
}

// Função auxiliar para adicionar tabela de pagamentos parciais do fechamento
const addClosurePaymentsTable = (
  doc: jsPDF,
  payments: ClosurePaymentItem[],
  summary: { netBalance: number; totalPaid: number; remainingAbs: number; isSettled: boolean },
  absoluteValues: boolean = false
): void => {
  if (!payments || payments.length === 0) return

  let yPos = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 12 : HEADER_HEIGHT + 6

  if (yPos > 250) {
    doc.addPage()
    yPos = HEADER_HEIGHT + 6
  }

  const pageWidth = doc.internal.pageSize.getWidth()
  const paymentColor = SECTION_COLORS.payments

  // Sinal do fechamento: negativo = viewer deve, positivo = viewer recebe
  const sign = summary.netBalance >= 0 ? 1 : -1
  const netBalanceAbs = Math.abs(summary.netBalance)

  // Formatação com sinal respeitando a flag absoluteValues
  const fmtBalance = absoluteValues ? formatCurrency(netBalanceAbs) : formatCurrency(summary.netBalance)
  const fmtRemaining = absoluteValues
    ? formatCurrency(Math.max(0, summary.remainingAbs))
    : formatCurrency(sign * Math.max(0, summary.remainingAbs))

  // Título
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Histórico de Pagamentos', 14, yPos)
  yPos += 5

  // Linha de resumo: Saldo | Pago | Restante | Status
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  const statusLabel = summary.isSettled ? 'Quitado' : 'Em aberto'
  const summaryLine = `Saldo do fechamento: ${fmtBalance}   |   Total pago: ${formatCurrency(summary.totalPaid)}   |   Saldo restante: ${fmtRemaining}   |   Status: ${statusLabel}`
  doc.text(summaryLine, 14, yPos)
  yPos += 6
  doc.setTextColor(0, 0, 0)

  // Acumular saldo para mostrar na coluna
  let accumulated = 0
  const tableRows = payments.map(p => {
    const amount = typeof p.amount === 'number' ? p.amount : parseFloat(String(p.amount)) || 0
    accumulated += amount                                          // sempre positivo (magnitude paga)
    const saldoRestanteAbs = Math.max(0, netBalanceAbs - accumulated)
    const saldoRestanteDisplay = absoluteValues ? saldoRestanteAbs : sign * saldoRestanteAbs
    return [
      new Date(p.payment_date).toLocaleDateString('pt-BR'),
      formatCurrency(amount),                                      // Valor Pago: sempre positivo
      sanitizeText(p.notes || '-'),
      formatCurrency(accumulated),                                 // Acumulado: sempre positivo
      formatCurrency(saldoRestanteDisplay),
    ]
  })

  autoTable(doc, {
    startY: yPos,
    margin: { top: HEADER_HEIGHT, left: 14, right: 14 },
    tableWidth: pageWidth - 28,
    head: [['Data', 'Valor Pago', 'Observações', 'Acumulado', 'Saldo Restante']],
    body: tableRows,
    foot: [['TOTAL', formatCurrency(summary.totalPaid), '', formatCurrency(accumulated), fmtRemaining]],
    showFoot: 'lastPage',
    theme: 'plain',
    headStyles: {
      fillColor: paymentColor,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    footStyles: {
      fillColor: [255, 250, 205],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    styles: { fontSize: 7, cellPadding: 2, lineWidth: 0.1, lineColor: [200, 200, 200] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { halign: 'right', cellWidth: 30 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        data.cell.styles.fillColor = data.row.index % 2 === 0 ? [255, 255, 255] : [240, 240, 240]
        if (data.column.index === 1 || data.column.index === 3) {
          data.cell.styles.textColor = greenColor
        }
        if (data.column.index === 4) {
          // Cor baseada no saldo restante absoluto (quanto falta pagar/receber)
          const paidSoFar = payments.slice(0, data.row.index + 1)
            .reduce((s, p) => s + (typeof p.amount === 'number' ? p.amount : parseFloat(String(p.amount)) || 0), 0)
          const restante = netBalanceAbs - paidSoFar
          data.cell.styles.textColor = restante <= 0.01 ? greenColor : redColor
        }
      }
      if (data.section === 'foot') {
        if (data.column.index === 1) data.cell.styles.textColor = greenColor
        if (data.column.index === 3) data.cell.styles.textColor = greenColor
        if (data.column.index === 4) {
          data.cell.styles.textColor = summary.remainingAbs <= 0.01 ? greenColor : redColor
          data.cell.styles.halign = 'right'
        }
      }
    }
  })
}

// Função auxiliar para adicionar tabela de pagamentos de empréstimos
const addLoanPaymentsTable = (doc: jsPDF, payments: LoanPaymentItem[], mainAccountName?: string, absoluteValues: boolean = false): void => {
  if (!payments || payments.length === 0) return

  let yPos = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 12 : HEADER_HEIGHT + 6

  // Check if we need a new page (deixar espaço para o cabeçalho)
  if (yPos > 250) {
    doc.addPage()
    yPos = HEADER_HEIGHT + 6
  }

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Liquidações de Empréstimos', 14, yPos)
  yPos += 5

  // Nota explicativa: dados são da perspectiva da conta principal
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 100, 100) // Cinza
  const perspectiveNote = mainAccountName
    ? `Dados referentes a perspectiva de ${sanitizeText(mainAccountName)}`
    : 'Dados referentes a perspectiva da Conta Principal'
  doc.text(perspectiveNote, 14, yPos)
  yPos += 5
  doc.setTextColor(0, 0, 0) // Resetar cor

  // Preparar dados com sinais corretos:
  // Emprestei (lent): Principal e Corrigido negativos (dinheiro que saiu)
  // Peguei (borrowed): Principal e Corrigido positivos (dinheiro que entrou)
  const tableData = payments.map(payment => {
    const isLent = payment.loan_type === 'lent'
    const typeLabel = isLent ? 'Emprestei' : 'Peguei'
    const cleanDescription = sanitizeText(payment.description || 'Empréstimo')

    // Valores com sinal baseado no tipo
    const principalDisplay = isLent ? -(payment.original_amount || 0) : (payment.original_amount || 0)
    const correctedDisplay = isLent ? -(payment.remaining_before || 0) : (payment.remaining_before || 0)
    const paidDisplay = isLent ? (payment.amount_paid || 0) : -(payment.amount_paid || 0)
    const afterDisplay = isLent ? (payment.remaining_after || 0) : -(payment.remaining_after || 0)

    // Formatar valores: negativo com sinal, positivo sem sinal, zero sem cor
    const formatWithSign = (value: number): string => {
      if (value === 0) return formatCurrency(0)
      if (absoluteValues) return formatCurrency(Math.abs(value))
      return value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value)
    }

    return {
      typeLabel,
      description: cleanDescription,
      principal: formatWithSign(principalDisplay),
      principalValue: principalDisplay,
      corrected: formatWithSign(correctedDisplay),
      correctedValue: correctedDisplay,
      paid: formatWithSign(paidDisplay),
      paidValue: paidDisplay,
      after: formatWithSign(afterDisplay),
      afterValue: afterDisplay,
      status: payment.is_settled ? 'Quitado' : 'Parcial',
      isLent
    }
  })

  const tableRows = tableData.map(row => [
    row.typeLabel,
    row.description,
    row.principal,
    row.corrected,
    row.paid,
    row.after,
    row.status
  ])

  // Header color (cinza igual às outras tabelas)
  const headerColor: [number, number, number] = [100, 100, 100]
  const blackColor: [number, number, number] = [31, 41, 55]  // gray-800

  // Calcular totais para a linha de rodapé
  const totalPrincipal = tableData.reduce((sum, row) => sum + row.principalValue, 0)
  const totalCorrected = tableData.reduce((sum, row) => sum + row.correctedValue, 0)
  const totalPaid = tableData.reduce((sum, row) => sum + row.paidValue, 0)
  const totalAfter = tableData.reduce((sum, row) => sum + row.afterValue, 0)

  // Formatar totais com sinal
  const formatTotalWithSign = (value: number): string => {
    if (value === 0) return formatCurrency(0)
    if (absoluteValues) return formatCurrency(Math.abs(value))
    return value < 0 ? `-${formatCurrency(Math.abs(value))}` : formatCurrency(value)
  }

  // Largura igual ao divisor: pageWidth - 28 (margem 14 de cada lado)
  const pageWidth = doc.internal.pageSize.getWidth()
  const tableWidthValue = pageWidth - 28  // 182mm em A4

  autoTable(doc, {
    startY: yPos,
    margin: { top: HEADER_HEIGHT, left: 14, right: 14 },
    tableWidth: tableWidthValue,
    head: [['Tipo', 'Descrição', 'Principal', 'Corrigido', 'Vlr. Liquidado', 'Saldo Após', 'Status']],
    body: tableRows,
    foot: [['TOTAL', '', formatTotalWithSign(totalPrincipal), formatTotalWithSign(totalCorrected), formatTotalWithSign(totalPaid), formatTotalWithSign(totalAfter), '']],
    showFoot: 'lastPage',
    theme: 'plain',
    headStyles: {
      fillColor: headerColor,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    footStyles: {
      fillColor: [255, 250, 205],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
      lineWidth: 0.1,
      lineColor: [180, 180, 180]
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineWidth: 0.1,
      lineColor: [200, 200, 200]
    },
    columnStyles: {
      0: { cellWidth: 20 },       // Tipo
      1: { cellWidth: 'auto' },   // Descrição (flex)
      2: { halign: 'right', cellWidth: 28 },  // Principal
      3: { halign: 'right', cellWidth: 28 },  // Valor Corrigido
      4: { halign: 'right', cellWidth: 26 },  // Valor Pago
      5: { halign: 'right', cellWidth: 26 },  // Saldo Após
      6: { halign: 'center', cellWidth: 18 }  // Status
    },
    didParseCell: (data) => {
      // Cores alternadas para linhas do body (cinza igual às outras tabelas)
      if (data.section === 'body') {
        if (data.row.index % 2 === 0) {
          data.cell.styles.fillColor = [255, 255, 255]  // Branco
        } else {
          data.cell.styles.fillColor = [240, 240, 240]  // Cinza claro (igual às outras tabelas)
        }

        const rowData = tableData[data.row.index]
        if (!rowData) return

        // Coluna Tipo: preto (sem cor)
        if (data.column.index === 0) {
          data.cell.styles.textColor = blackColor
        }

        // Colunas de valores: verde positivo, vermelho negativo, preto zero
        const getColorForValue = (value: number): [number, number, number] => {
          if (value === 0) return blackColor
          return value < 0 ? redColor : greenColor
        }

        // Principal (col 2)
        if (data.column.index === 2) {
          data.cell.styles.textColor = getColorForValue(rowData.principalValue)
        }
        // Valor Corrigido (col 3)
        if (data.column.index === 3) {
          data.cell.styles.textColor = getColorForValue(rowData.correctedValue)
        }
        // Valor Pago (col 4)
        if (data.column.index === 4) {
          data.cell.styles.textColor = getColorForValue(rowData.paidValue)
        }
        // Saldo Após (col 5)
        if (data.column.index === 5) {
          data.cell.styles.textColor = getColorForValue(rowData.afterValue)
        }

        // Coluna Status: preto (sem cor especial)
        if (data.column.index === 6) {
          data.cell.styles.textColor = blackColor
        }
      }
      // Footer: alinhar valores à direita e colorir negativos de vermelho
      if (data.section === 'foot') {
        // Alinhar colunas de valores à direita (Principal, Corrigido, Valor, Saldo Após)
        if (data.column.index >= 2 && data.column.index <= 5) {
          data.cell.styles.halign = 'right'
        }

        // Colorir valores negativos de vermelho
        const footerTotals = [null, null, totalPrincipal, totalCorrected, totalPaid, totalAfter, null]
        const totalValue = footerTotals[data.column.index]
        if (totalValue !== null && totalValue < 0) {
          data.cell.styles.textColor = redColor
        }
      }
    }
  })
}
