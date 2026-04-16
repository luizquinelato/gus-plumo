import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { getIconComponent } from '../utils/iconMapper'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface IconPickerProps {
  value: string
  onChange: (iconName: string) => void
  availableIcons: string[]
  iconNamesPt?: Record<string, string>  // Mapeamento de nomes em português
}

// Categorias de ícones
const iconCategories: Record<string, string[]> = {
  'Básicos': ['Tag', 'Tags', 'Folder', 'FolderOpen', 'Bookmark', 'Star', 'Heart'],
  'Compras e Alimentação': [
    'ShoppingCart', 'ShoppingBag', 'Coffee', 'Utensils', 'UtensilsCrossed', 'Pizza',
    'Apple', 'Beef', 'Croissant', 'Fish', 'Store', 'Salad', 'Soup', 'Candy',
    'CandyCane', 'Cherry', 'Citrus', 'Grape', 'Milk', 'Wine', 'Beer',
    'Martini', 'GlassWater', 'IceCream', 'Cake', 'Cookie', 'Donut', 'Egg',
    'Sandwich', 'Carrot', 'Banana'
  ],
  'Casa e Transporte': [
    'Home', 'Building', 'Building2', 'Car', 'Bus', 'Train', 'Plane', 'Bike',
    'Fuel', 'ParkingCircle', 'Ship', 'Truck', 'Ambulance', 'Rocket',
    'Warehouse', 'Factory', 'Hotel', 'Church', 'TreePine', 'Trees', 'Flower', 'Flower2',
    'Sofa', 'Bed', 'Armchair', 'Lamp', 'LampDesk', 'Bath', 'ShowerHead',
    'DoorOpen', 'DoorClosed', 'Fence', 'Drill', 'PaintBucket'
  ],
  'Tecnologia': [
    'Smartphone', 'Laptop', 'Monitor', 'Tv', 'Gamepad', 'Gamepad2', 'Music',
    'Film', 'Camera', 'Image', 'Book', 'BookOpen', 'Newspaper', 'FileText',
    'Wifi', 'Youtube', 'Video', 'Bot', 'Layout', 'Palette', 'Headphones',
    'Mic', 'Radio', 'Speaker', 'Usb', 'HardDrive', 'Database', 'Server',
    'Cloud', 'Download', 'Upload', 'Bluetooth', 'Cast', 'Cpu', 'MemoryStick',
    'Printer', 'ScanLine', 'Keyboard', 'Mouse'
  ],
  'Finanças': [
    'DollarSign', 'CreditCard', 'Wallet', 'PiggyBank', 'TrendingUp', 'TrendingDown',
    'Banknote', 'Receipt', 'Percent', 'Coins', 'CircleDollarSign', 'BadgeDollarSign',
    'Calculator', 'BarChart', 'LineChart', 'PieChart', 'ArrowUpCircle', 'ArrowDownCircle',
    'BadgePercent'
  ],
  'Trabalho e Produtividade': [
    'Activity', 'Package', 'Gift', 'Award', 'Briefcase', 'Calendar', 'Clock',
    'MapPin', 'Globe', 'Zap', 'ClipboardList', 'ClipboardCheck', 'FileCheck',
    'FilePlus', 'FileEdit', 'Presentation', 'Target', 'Trophy', 'Medal', 'Crown'
  ],
  'Saúde e Bem-estar': [
    'HeartPulse', 'Pill', 'Stethoscope', 'Baby', 'Brain', 'Smile', 'Ear',
    'Syringe', 'Dumbbell', 'PersonStanding', 'Dog', 'Cat', 'Footprints',
    'Eye', 'EyeOff', 'Thermometer', 'Accessibility', 'Bone', 'Rabbit'
  ],
  'Natureza e Clima': [
    'Droplet', 'Droplets', 'Flame', 'Wind', 'Sun', 'Moon', 'Waves', 'Leaf',
    'Sprout', 'TreeDeciduous', 'Bug', 'Bird', 'Snowflake', 'CloudRain', 'CloudSnow',
    'CloudSun', 'Sunrise', 'Sunset', 'Rainbow', 'Palmtree', 'Mountain',
    'Tent', 'Compass', 'Squirrel'
  ],
  'Vestuário e Acessórios': [
    'Umbrella', 'Shirt', 'Watch', 'Glasses', 'Scissors', 'Gem',
    'Sparkles', 'ShoppingBasket', 'Footprints'
  ],
  'Ferramentas e Configurações': [
    'Wrench', 'Settings', 'Sliders', 'Filter', 'Search', 'Bell',
    'Hammer', 'Paintbrush', 'Plug', 'Lock', 'Unlock', 'Key',
    'BellRing', 'Cog', 'SlidersHorizontal'
  ],
  'Comunicação e Pessoas': [
    'Mail', 'MessageCircle', 'Phone', 'Users', 'User', 'UserPlus',
    'MailOpen', 'Send', 'Inbox', 'Archive', 'MessageSquare', 'PhoneCall',
    'Voicemail', 'AtSign', 'Hash', 'Share', 'Share2', 'ThumbsUp', 'ThumbsDown',
    'UserCircle', 'UserCheck', 'UserMinus', 'UserX'
  ],
  'Educação e Trabalho': [
    'GraduationCap', 'School', 'Backpack', 'Pencil', 'Pen', 'PenTool',
    'BookMarked', 'Library', 'Ruler', 'Eraser', 'Highlighter'
  ],
  'Lazer e Entretenimento': [
    'PartyPopper', 'Gift', 'Cake', 'IceCream', 'Popcorn', 'Clapperboard', 'Trophy',
    'Medal', 'Target', 'Flame', 'Palmtree', 'Mountain', 'Waves', 'Tent',
    'Compass', 'Map', 'Navigation', 'Anchor', 'Sailboat', 'Puzzle',
    'Dice1', 'Dice2', 'Dice3', 'Dice4', 'Dice5', 'Dice6', 'Dices'
  ],
  'Diversos': [
    'HelpCircle', 'AlertTriangle', 'AlertCircle', 'XCircle', 'Ticket',
    'Lightbulb', 'RotateCcw', 'RefreshCw', 'Trash', 'Trash2', 'Box', 'Package2',
    'CheckCircle', 'CheckCircle2', 'Info', 'AlertOctagon', 'Shapes', 'Circle',
    'Square', 'Triangle', 'Hexagon', 'Octagon', 'Pentagon'
  ]
}

const IconPicker = ({ value, onChange, availableIcons, iconNamesPt = {} }: IconPickerProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Hook para fechar modal com ESC
  useEscapeKey(() => setIsOpen(false), isOpen)

  // Filtra ícones por busca
  const filteredIcons = availableIcons.filter(icon => {
    const englishName = icon.toLowerCase()
    const portugueseName = (iconNamesPt[icon] || '').toLowerCase()
    const search = searchTerm.toLowerCase()

    // Busca tanto no nome em inglês quanto no português
    return englishName.includes(search) || portugueseName.includes(search)
  })

  // Organiza ícones filtrados por categoria
  const categorizedIcons: Record<string, string[]> = {}

  if (searchTerm) {
    // Se houver busca, mostra todos os resultados em uma única lista
    categorizedIcons['Resultados'] = filteredIcons
  } else {
    // Sem busca, organiza por categorias
    Object.entries(iconCategories).forEach(([category, icons]) => {
      const categoryIcons = icons.filter(icon => availableIcons.includes(icon))
      if (categoryIcons.length > 0) {
        categorizedIcons[category] = categoryIcons
      }
    })

    // Adiciona ícones que não estão em nenhuma categoria
    const categorizedIconsList = Object.values(iconCategories).flat()
    const uncategorized = availableIcons.filter(icon => !categorizedIconsList.includes(icon))
    if (uncategorized.length > 0) {
      categorizedIcons['Outros'] = uncategorized
    }
  }

  const SelectedIcon = getIconComponent(value)

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        Ícone
      </label>

      {/* Botão para abrir o picker */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600 text-sm"
      >
        <div className="flex items-center gap-2">
          <SelectedIcon size={16} />
          <span>{iconNamesPt[value] || value}</span>
        </div>
        <span className="text-gray-400 text-xs">▼</span>
      </button>

      {/* Modal do picker */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-5xl w-full max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Selecionar Ícone
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="Fechar (ESC)"
              >
                <X size={20} className="text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar ícone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  autoFocus
                />
              </div>
            </div>

            {/* Grid de ícones por categoria */}
            <div className="flex-1 overflow-y-auto p-4">
              {Object.entries(categorizedIcons).map(([category, icons]) => (
                <div key={category} className="mb-6 last:mb-0">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 px-1">
                    {category}
                  </h4>
                  <div className="grid grid-cols-8 gap-2">
                    {icons.map((iconName) => {
                      const IconComponent = getIconComponent(iconName)
                      const isSelected = iconName === value

                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => {
                            onChange(iconName)
                            setIsOpen(false)
                          }}
                          className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 dark:border-gray-600'
                          }`}
                          title={iconNamesPt[iconName] || iconName}
                        >
                          <IconComponent size={24} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'} />
                          <span className={`text-xs truncate w-full text-center ${
                            isSelected ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            {iconNamesPt[iconName] || iconName}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              {filteredIcons.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Nenhum ícone encontrado
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {filteredIcons.length} ícones disponíveis
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IconPicker

