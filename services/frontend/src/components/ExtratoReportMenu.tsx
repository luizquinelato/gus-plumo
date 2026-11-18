import { FileText } from 'lucide-react'
import CadastroExcelMenu from './CadastroExcelMenu'

interface ExtratoReportMenuProps {
  disabled?: boolean
  compact?: boolean
  onExportExcel: () => void
  onExportPdf: () => void
}

export default function ExtratoReportMenu({
  disabled = false,
  compact = false,
  onExportExcel,
  onExportPdf,
}: ExtratoReportMenuProps) {
  return (
    <CadastroExcelMenu
      disabled={disabled}
      compact={compact}
      menuTitle="Exportar"
      onExportExcel={onExportExcel}
      extraItems={[
        {
          id: 'pdf',
          label: 'Exportar PDF',
          icon: <FileText size={16} />,
          onClick: onExportPdf,
        },
      ]}
    />
  )
}
