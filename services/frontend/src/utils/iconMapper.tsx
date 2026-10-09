import * as LucideIcons from 'lucide-react'

/**
 * Mapeia o nome do ícone (string) para o componente do Lucide React
 * @param iconName - Nome do ícone (ex: "Heart", "ShoppingBag", "Tag")
 * @returns Componente do ícone ou Tag como fallback
 */
export function findIconComponent(
  iconName: string | null | undefined,
): React.ComponentType<LucideIcons.LucideProps> | null {
  if (!iconName) return null
  const IconComponent = (LucideIcons as unknown as Record<string, React.ComponentType<LucideIcons.LucideProps> | undefined>)[
    iconName
  ]
  return IconComponent ?? null
}

export function getIconComponent(iconName: string | null | undefined): React.ComponentType<LucideIcons.LucideProps> {
  if (!iconName) {
    return LucideIcons.Tag
  }

  // Tenta buscar o ícone no Lucide
  const IconComponent = (LucideIcons as any)[iconName]

  // Se não encontrar, retorna Tag como fallback
  if (!IconComponent) {
    console.warn(`Ícone "${iconName}" não encontrado no Lucide. Usando Tag como fallback.`)
    return LucideIcons.Tag
  }

  return IconComponent
}

