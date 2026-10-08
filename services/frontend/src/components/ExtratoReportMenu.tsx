import { FileText } from 'lucide-react'
import CadastroExcelMenu from './CadastroExcelMenu'

interface ExtratoReportMenuProps {
  disabled?: boolean
  onImportExcel: () => void
  onExportExcel: () => void
  onExportPdf: () => void
}

export default function ExtratoReportMenu({
  disabled = false,
  onImportExcel,
  onExportExcel,
  onExportPdf,
}: ExtratoReportMenuProps) {
  return (
    <CadastroExcelMenu
      disabled={disabled}
      onImportExcel={onImportExcel}
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
