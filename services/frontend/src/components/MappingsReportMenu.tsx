import { Eraser } from 'lucide-react'
import CadastroExcelMenu, { type CadastroExcelMenuProps } from './CadastroExcelMenu'

interface MappingsReportMenuProps extends Omit<CadastroExcelMenuProps, 'extraItems'> {
  clearing?: boolean
  onClearClassifications: () => void
}

/** Menu de mapeamentos: exportar + limpar categorias. */
export default function MappingsReportMenu({
  clearing = false,
  onClearClassifications,
  ...rest
}: MappingsReportMenuProps) {
  return (
    <CadastroExcelMenu
      {...rest}
      menuTitle="Exportar e limpar"
      extraItems={[
        {
          id: 'clear',
          label: clearing ? 'Limpando categorias…' : 'Limpar categorias',
          icon: <Eraser size={16} />,
          onClick: onClearClassifications,
          disabled: clearing,
          loading: clearing,
        },
      ]}
    />
  )
}
