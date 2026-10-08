import { AlertTriangle } from 'lucide-react'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
} from './CadastroFormLayout'
import ClosureEditImpactContent from './ClosureEditImpactContent'
import type { ClosureEditImpact } from '../types/closureEditImpact'

interface ClosureEditImpactDialogProps {
  isOpen: boolean
  impact: ClosureEditImpact | null
  onClose: () => void
  onConfirm: () => void
  confirmText?: string
  confirming?: boolean
}

const ClosureEditImpactDialog = ({
  isOpen,
  impact,
  onClose,
  onConfirm,
  confirmText = 'Aplicar alteração',
  confirming = false,
}: ClosureEditImpactDialogProps) => {
  if (!impact || !isOpen) return null

  const title =
    impact.impact_type === 'financial'
      ? 'Alteração afeta fechamentos'
      : impact.impact_type === 'split_recalc'
        ? 'Recalcular compartilhamento nos fechamentos'
        : 'Atualizar fechamentos'

  return (
    <CadastroModalShell maxWidth="max-w-xl" onBackdropClick={onClose} zClass="z-[120]">
      <CadastroModalHeader
        isEdit={false}
        title={title}
        subtitle="Detalhes por mês aparecem depois de aplicar"
        onClose={onClose}
        icon={<AlertTriangle size={18} />}
        iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
      />
      <CadastroModalBody>
        <ClosureEditImpactContent impact={impact} variant="confirm" />
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={onConfirm}
        saving={confirming}
        saveLabel={confirmText}
        closeLabel="Cancelar"
        saveTone="success"
      />
    </CadastroModalShell>
  )
}

export default ClosureEditImpactDialog
