# Sistema de Cores

Sistema completo de gerenciamento de cores personalizadas com suporte a acessibilidade e temas.

## Visão Geral

O sistema permite personalizar 6 cores principais com:
- ✅ 3 níveis de acessibilidade (Regular, AA, AAA)
- ✅ Suporte a temas light/dark
- ✅ Cálculo automático de variantes
- ✅ Cache inteligente com localStorage
- ✅ API unificada para performance

## Estrutura de Dados

### 12 Combinações por Tenant

```
2 modos (default, custom)
× 2 temas (light, dark)
× 3 níveis de acessibilidade (regular, AA, AAA)
= 12 registros no banco
```

### Modelo de Dados

```python
class TenantColor(Base):
    id: int
    tenant_id: int
    mode: str              # "default" ou "custom"
    theme: str             # "light" ou "dark"
    accessibility: str     # "regular", "AA", "AAA"
    color_1: str           # Hex color
    color_2: str
    color_3: str
    color_4: str
    color_5: str
    color_6: str
    active: bool
```

## Níveis de Acessibilidade

### Regular
- Contraste mínimo: 3:1
- Uso: Elementos decorativos

### AA (WCAG 2.1 Level AA)
- Contraste mínimo: 4.5:1
- Uso: Texto normal, interfaces padrão

### AAA (WCAG 2.1 Level AAA)
- Contraste mínimo: 7:1
- Uso: Texto pequeno, alta acessibilidade

## Cálculo de Cores

### Backend: ColorCalculationService

**Funções principais**:

```python
# Calcula luminância relativa
get_relative_luminance(hex_color: str) -> float

# Calcula contraste entre duas cores
calculate_contrast(color1: str, color2: str) -> float

# Ajusta cor para atingir contraste mínimo
adjust_color_for_contrast(
    color: str,
    background: str,
    min_contrast: float,
    lighten: bool
) -> str

# Gera variantes de uma cor
generate_color_variants(base_color: str) -> dict
```

### Variantes Geradas

Para cada cor base, são geradas 9 variantes:

```python
{
    "50": "#f0f9ff",   # Muito claro
    "100": "#e0f2fe",
    "200": "#bae6fd",
    "300": "#7dd3fc",
    "400": "#38bdf8",
    "500": "#0ea5e9",  # Base
    "600": "#0284c7",
    "700": "#0369a1",
    "800": "#075985",
    "900": "#0c4a6e"   # Muito escuro
}
```

## API Backend

### Endpoint Unificado

```
GET /api/colors/unified?mode={mode}&theme={theme}&accessibility={accessibility}
```

**Parâmetros**:
- `mode`: "default" ou "custom"
- `theme`: "light" ou "dark"
- `accessibility`: "regular", "AA", "AAA"

**Response**:
```json
{
  "colors": {
    "color_1": "#3b82f6",
    "color_2": "#10b981",
    "color_3": "#f59e0b",
    "color_4": "#ef4444",
    "color_5": "#8b5cf6",
    "color_6": "#ec4899"
  },
  "variants": {
    "color_1": {
      "50": "#eff6ff",
      "100": "#dbeafe",
      ...
      "900": "#1e3a8a"
    },
    ...
  }
}
```

### Outros Endpoints

```
GET  /api/colors/defaults                    # Cores padrão
GET  /api/colors/custom                      # Cores customizadas
POST /api/colors/custom                      # Salva cores customizadas
GET  /api/colors/variants/{color_number}     # Variantes de uma cor
```

## Frontend

### ColorDataService (Singleton)

Serviço centralizado com cache em localStorage.

**Uso**:
```typescript
import { ColorDataService } from '../services/ColorDataService'

const service = ColorDataService.getInstance()

// Busca cores (com cache)
const data = await service.getColorData('custom', 'light', 'AA')

// Limpa cache
service.clearCache()
```

**Cache**:
- Chave: `color_data_{mode}_{theme}_{accessibility}`
- TTL: 5 minutos
- Armazenamento: localStorage

### Hook: useColorData

React hook para consumir cores nos componentes.

**Uso**:
```typescript
import { useColorData } from '../hooks/useColorData'

function MyComponent() {
  const { getColors, getVariants, isLoading } = useColorData()
  
  // Busca cores
  const colors = getColors('custom', 'light', 'AA')
  
  // Busca variantes
  const variants = getVariants('custom', 'light', 'AA')
  
  return (
    <div style={{ color: colors.color_1 }}>
      {/* ... */}
    </div>
  )
}
```

### Componente: ColorCustomizerUnified

Editor visual de cores com preview em tempo real.

**Funcionalidades**:
- Seleção de modo (Default/Custom)
- Seleção de tema (Light/Dark)
- Seleção de nível de acessibilidade
- Color pickers para 6 cores
- Preview de variantes
- Botão "Salvar Cores"
- Botão "Resetar para Padrão"

**Uso**:
```tsx
import ColorCustomizerUnified from '../components/ColorCustomizerUnified'

<ColorCustomizerUnified />
```

### Componente: ColorVariantsPreview

Preview visual das variantes de uma cor.

**Uso**:
```tsx
import ColorVariantsPreview from '../components/ColorVariantsPreview'

<ColorVariantsPreview
  colorNumber={1}
  variants={variants.color_1}
/>
```

## Aplicação de Cores

### CSS Variables

As cores são aplicadas via CSS variables:

```css
:root {
  --color-1: #3b82f6;
  --color-2: #10b981;
  --color-3: #f59e0b;
  --color-4: #ef4444;
  --color-5: #8b5cf6;
  --color-6: #ec4899;
  
  --color-1-50: #eff6ff;
  --color-1-100: #dbeafe;
  /* ... */
}
```

### TailwindCSS

Configuração em `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'var(--color-1-50)',
          100: 'var(--color-1-100)',
          // ...
          900: 'var(--color-1-900)',
        }
      }
    }
  }
}
```

**Uso**:
```tsx
<div className="bg-primary-500 text-white">
  Texto com cor primária
</div>
```

## Fluxo Completo

### 1. Inicialização

```
App carrega
  ↓
ColorDataService.getInstance()
  ↓
Verifica cache localStorage
  ↓
Se não existe: Busca do backend
  ↓
Salva no cache
  ↓
Aplica CSS variables
```

### 2. Customização

```
Usuário abre ColorCustomizerUnified
  ↓
Seleciona modo/tema/acessibilidade
  ↓
Altera cores com color pickers
  ↓
Clica em "Salvar Cores"
  ↓
POST /api/colors/custom
  ↓
Backend salva no banco
  ↓
Frontend limpa cache
  ↓
Recarrega cores
  ↓
Aplica novas CSS variables
```

### 3. Mudança de Tema

```
Usuário clica em toggle dark/light
  ↓
ColorDataService.getColorData('custom', 'dark', 'AA')
  ↓
Verifica cache
  ↓
Se não existe: Busca do backend
  ↓
Aplica CSS variables do tema dark
```

## Migration

### 0003_add_accessibility_levels.py

Cria registros para todos os níveis de acessibilidade.

**Execução**:
```bash
python -m services.backend.scripts.migrations.0003_add_accessibility_levels
```

**Ações**:
1. Busca cores existentes (regular)
2. Para cada tenant:
   - Cria registros AA (ajustados para contraste 4.5:1)
   - Cria registros AAA (ajustados para contraste 7:1)
3. Mantém cores regular inalteradas

## Boas Práticas

### Performance
- ✅ Use `ColorDataService` (singleton com cache)
- ✅ Use `useColorData` hook nos componentes
- ❌ Não faça chamadas diretas à API

### Acessibilidade
- ✅ Use nível AA para interfaces padrão
- ✅ Use nível AAA para texto pequeno
- ✅ Teste contraste com ferramentas WCAG

### Temas
- ✅ Sempre forneça cores para light e dark
- ✅ Teste interface em ambos os temas
- ✅ Use CSS variables para facilitar mudanças

