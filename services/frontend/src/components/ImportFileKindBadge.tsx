import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  FolderTree,
  Gift,
  Handshake,
  Landmark,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { KIND_LABEL, type WizardKind } from '../utils/importWizard'

export interface KindBadgeInfo {
  issuer?: string | null
  issuerLabel?: string | null
  cardLast4?: string | null
}

interface BadgeSpec {
  text: string
  title: string
  className?: string
  style?: CSSProperties
}

const badgeBaseCls =
  'inline-flex min-w-[100px] items-center justify-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium'

const EXTRATO_BTG: BadgeSpec = {
  text: 'BTG - Extrato',
  title: 'Extrato BTG Pactual (arquivo original)',
  className:
    'bg-[#C5D4EF] text-[#001E62] border border-[#001E62]/25 dark:bg-[#163875] dark:text-[#E8EEF7] dark:border-[#4A7BC8]/45',
}

const EXTRATO_ITAU: BadgeSpec = {
  text: 'Itaú - Extrato',
  title: 'Extrato Itaú (PDF)',
  className: 'bg-[#EC7000] text-white dark:bg-[#EC7000] dark:text-white',
}

const CONSORCIO_PORTO: BadgeSpec = {
  text: 'Porto Seguro',
  title: 'Extrato de consórcio Porto Seguro (PDF)',
  className: 'bg-[#0046C0] text-white dark:bg-[#0046C0] dark:text-white',
}

const CONSORCIO_RODOBENS: BadgeSpec = {
  text: 'Rodobens',
  title: 'Extrato de consórcio Rodobens (PDF)',
  className: 'bg-[#00A651] text-white dark:bg-[#00A651] dark:text-white',
}

function issuerBadge(issuer?: string | null, label?: string | null): BadgeSpec {
  if (issuer === 'btg') {
    return {
      text: 'BTG - Cartão',
      title: 'Fatura BTG Pactual',
      className: 'bg-[#001E62] text-white dark:bg-[#0B3A8F] dark:text-white',
    }
  }
  if (issuer === 'mercadopago') {
    return {
      text: 'Mercado Pago',
      title: 'Fatura Mercado Pago',
      className: 'bg-[#FFE600] text-[#333333] dark:bg-[#FFE600] dark:text-[#1A1A1A]',
    }
  }
  return {
    text: label || 'Fatura',
    title: 'Fatura de cartão',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }
}

function colorBadge(text: string, title: string, color: string): BadgeSpec {
  return { text, title, style: { background: `var(${color})`, color: `var(--on-${color.slice(2)})` } }
}

function badgeSpec(kind: WizardKind, info: KindBadgeInfo): BadgeSpec {
  switch (kind) {
    case 'holerite':
      return colorBadge('Holerite', 'Holerite (PDF)', '--color-1')
    case 'informe':
      return colorBadge('Informe', 'Informe de rendimentos (PDF)', '--color-2')
    case 'consorcio':
      if (info.issuerLabel === 'Porto Seguro') return CONSORCIO_PORTO
      if (info.issuerLabel === 'Rodobens') return CONSORCIO_RODOBENS
      return colorBadge('Consórcio', 'Extrato de consórcio (PDF)', '--color-3')
    case 'beneficio_csv':
      return colorBadge('Benefício CSV', 'Extrato do cartão de benefícios (CSV)', '--color-3')
    case 'extrato_bruto':
      return info.issuer === 'itau_extrato' ? EXTRATO_ITAU : EXTRATO_BTG
    case 'fatura_bruta': {
      const badge = issuerBadge(info.issuer, info.issuerLabel)
      return { ...badge, title: [badge.title, info.cardLast4 ? `final ${info.cardLast4}` : null].filter(Boolean).join(' • ') }
    }
    case 'blocked':
      return {
        text: KIND_LABEL.blocked,
        title: 'Arquivo não reconhecido',
        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      }
    default:
      return {
        text: KIND_LABEL[kind],
        title: `Planilha exportada pelo Plumo · ${KIND_LABEL[kind]}`,
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200',
      }
  }
}

export function KindBadge({ kind, info = {} }: { kind: WizardKind; info?: KindBadgeInfo }) {
  const spec = badgeSpec(kind, info)
  return (
    <span className={`${badgeBaseCls} ${spec.className ?? ''}`} style={spec.style} title={spec.title}>
      {spec.text}
    </span>
  )
}

const KIND_ICON: Record<WizardKind, { icon: LucideIcon; color: string; title: string }> = {
  holerite: { icon: Briefcase, color: 'var(--color-1)', title: 'Holerite' },
  informe: { icon: Briefcase, color: 'var(--color-2)', title: 'Informe de rendimentos' },
  consorcio: { icon: Handshake, color: 'var(--color-3)', title: 'Extrato de consórcio' },
  beneficio_csv: { icon: Gift, color: 'var(--color-3)', title: 'Benefício' },
  fatura_bruta: { icon: CreditCard, color: 'var(--color-2)', title: 'Fatura de cartão' },
  extrato_bruto: { icon: Landmark, color: 'var(--color-1)', title: 'Extrato bancário' },
  extrato_export: { icon: FileText, color: 'var(--color-1)', title: 'Extrato (Plumo)' },
  fatura_export: { icon: CreditCard, color: 'var(--color-2)', title: 'Faturas (Plumo)' },
  mapeamentos: { icon: FolderTree, color: 'var(--color-1)', title: 'Mapeamentos' },
  tags: { icon: Tags, color: 'var(--color-1)', title: 'Tags e subtags' },
  templates: { icon: FileText, color: 'var(--color-2)', title: 'Templates' },
  contas: { icon: Building2, color: 'var(--color-1)', title: 'Contas' },
  compartilhamentos: { icon: Users, color: 'var(--color-3)', title: 'Compartilhamentos' },
  cartoes: { icon: CreditCard, color: 'var(--color-3)', title: 'Cartões' },
  blocked: { icon: AlertTriangle, color: 'var(--color-danger)', title: 'Não reconhecido' },
}

export function KindIcon({ kind, size = 22 }: { kind: WizardKind; size?: number }) {
  const spec = KIND_ICON[kind]
  const Icon = spec.icon
  return (
    <span className="inline-flex cursor-default" title={spec.title}>
      <Icon size={size} style={{ color: spec.color }} aria-hidden />
    </span>
  )
}
