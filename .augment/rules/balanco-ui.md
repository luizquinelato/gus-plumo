---
type: "always_apply"
---

# Regras de UI - Página de Balanço

## Estrutura de Cards

### Regra: Separação entre Resumo e Detalhes

**SEMPRE** que trabalhar com a página de Balanço (`BalancoPage.tsx`), mantenha a seguinte estrutura:

#### 1. **Cards de Resumo (Coloridos)**
- **Propósito**: Mostrar valores totais e status de forma visual
- **Características**:
  - Fundo colorido baseado no status (verde = a receber, vermelho = a pagar, cinza = zerado)
  - Borda de 2px com a cor do status
  - Hover effect com `hover:shadow-xl hover:border-color-primary`
  - **NÃO** deve conter detalhes de transações
  - Apenas: Header, Valores Totais, Saldo Líquido, Status

#### 2. **Cards de Detalhes (Neutros)**
- **Propósito**: Mostrar transações individuais expandíveis
- **Características**:
  - Fundo neutro (`bg-white dark:bg-gray-800`)
  - Borda simples (`border border-gray-200 dark:border-gray-700`)
  - **2 cards separados** (um para cada conta) ao invés de 1 card grande
  - Grid responsivo: `grid grid-cols-1 md:grid-cols-2 gap-6`
  - Header com ícone `Receipt` e nome da conta
  - Seções expandíveis para Despesas e Receitas

### Estrutura HTML Correta

```tsx
{/* Cards de Balanço - APENAS RESUMO */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
  {/* Card: Conta Principal */}
  <div className={`rounded-xl p-6 border-2 shadow-lg transition-all hover:shadow-xl hover:border-color-primary ${statusColors}`}>
    {/* Header + Valores + Status */}
  </div>

  {/* Card: Conta Parceira */}
  <div className={`rounded-xl p-6 border-2 shadow-lg transition-all hover:shadow-xl hover:border-color-primary ${statusColors}`}>
    {/* Header + Valores + Status */}
  </div>
</div>

{/* Cards de Detalhes das Transações - 2 CARDS SEPARADOS */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
  {/* Card 1: Detalhes da Conta Principal */}
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
      <Receipt size={18} className="text-color-primary" />
      {accountName}
    </h3>
    {/* Despesas + Receitas expandíveis */}
  </div>

  {/* Card 2: Detalhes da Conta Parceira */}
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
      <Receipt size={18} className="text-color-primary" />
      {partnerAccountName}
    </h3>
    {/* Despesas + Receitas expandíveis */}
  </div>
</div>
```

### Justificativa

1. **Hierarquia Visual Clara**: Resumo (colorido) → Detalhes (neutro)
2. **Separação de Responsabilidades**: Cada card tem um propósito único
3. **Melhor Uso do Espaço**: 2 cards separados permitem alturas independentes
4. **Consistência**: Todos os cards seguem o mesmo padrão de design

---

## CSS Variables

### Regra: Usar Variáveis CSS ao invés de Cores Fixas

**SEMPRE** use variáveis CSS customizadas ao invés de cores fixas (como `purple-600`, `blue-500`, etc.):

### Classes Disponíveis

```css
/* Texto */
.text-color-primary          /* var(--color-1) - Azul */

/* Background */
.bg-color-primary            /* var(--color-1) - Azul sólido */
.bg-color-primary-light      /* var(--color-1) - Azul com 10% opacidade */

/* Bordas */
.border-color-primary        /* var(--color-1) - Azul */
.border-color-primary-border /* var(--color-1) - Azul com 30% opacidade */

/* Focus Ring */
.ring-color-primary          /* var(--color-1) - Azul */
```

### Mapeamento de Cores

| Variável | Cor | Uso Principal |
|----------|-----|---------------|
| `--color-1` | Azul (#2862EB) | **Primary** - Tabs, ícones, destaques principais |
| `--color-2` | Roxo (#763DED) | Secondary - Elementos de suporte |
| `--color-3` | Verde (#059669) | Success - Feedback positivo |
| `--color-4` | Cyan (#0EA5E9) | Trust - Elementos importantes |
| `--color-5` | Laranja (#F59E0B) | Energy - Alertas |

### Cores de Status (Fixas - Não Customizáveis)

Para status do sistema, use cores fixas do Tailwind:

```tsx
// ✅ CORRETO - Status de balanço
status === 'to_receive' 
  ? 'bg-green-100 dark:bg-green-900/30 border-green-400'
  : 'bg-red-100 dark:bg-red-900/30 border-red-400'

// ✅ CORRETO - Valores monetários
amount > 0 
  ? 'text-green-600 dark:text-green-400'
  : 'text-red-600 dark:text-red-400'
```

### Exemplos de Uso

```tsx
// ❌ INCORRETO - Cores fixas
<div className="text-purple-600 dark:text-purple-400">
  <Calendar className="text-blue-500" />
</div>

// ✅ CORRETO - Variáveis CSS
<div className="text-color-primary">
  <Calendar className="text-color-primary" />
</div>
```

### Justificativa

- **Consistência**: Todas as cores primárias usam a mesma variável
- **Customização**: Fácil trocar o tema da aplicação
- **Manutenção**: Mudanças em um único lugar
- **Dark Mode**: Funciona automaticamente

---

## Layout e Espaçamento

### Regra: Economia de Espaço Vertical

**SEMPRE** que possível, coloque elementos relacionados na mesma linha:

### Exemplos

#### ✅ CORRETO - Filtros com ícones inline
```tsx
<label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
  <Building2 size={14} className="inline mr-1 text-color-primary" />
  Conta Parceira
</label>
```

#### ❌ INCORRETO - Header separado para filtros
```tsx
<div className="mb-4">
  <h3>Filtros</h3>
</div>
<div>
  <label>Conta Parceira</label>
</div>
```

### Justificativa

- Economiza ~60px de altura vertical
- Mais espaço para conteúdo principal
- Interface mais limpa e compacta

---

## Lógica de Seleção de Card (Aba Fechamentos)

### Regra: Seleção de Card Baseada na Conta Logada

**SEMPRE** que exibir fechamentos na aba "Fechamentos", selecione o card correto baseado na conta logada.

### Contexto

O JSON de um fechamento contém **dois cards** completos com os valores de cada perspectiva:
- `closure_data.main_account_card` = dados da conta que criou o fechamento
- `closure_data.partner_account_card` = dados da contraparte

Cada card já contém os valores corretos da perspectiva daquela conta:
- `total_to_receive` = valor que aquela conta tem a receber
- `total_to_pay` = valor que aquela conta tem a pagar
- `net_balance` = saldo líquido daquela conta

### Lógica de Seleção de Card

```typescript
// 1. Identificar a conta principal do fechamento
const closureMainAccountId = Number(mainCard.account_id || closure.account_id)

// 2. Verificar se a conta logada é a contraparte
const isCounterpart = Number(loggedAccountId) !== closureMainAccountId

// 3. Selecionar o card correto (NÃO inverter valores!)
const viewerCard = isCounterpart ? partnerCard : mainCard
const otherCard = isCounterpart ? mainCard : partnerCard

// 4. Usar valores diretamente do card selecionado
const totalToReceive = parseFloat(viewerCard.total_to_receive ?? 0)
const totalToPay = parseFloat(viewerCard.total_to_pay ?? 0)
const netBalance = totalToReceive - totalToPay
```

### Inversão de Colunas na Tabela

As colunas "Conta Principal" e "Contraparte" também são invertidas para que a conta logada sempre apareça como "Conta Principal":

```typescript
// Coluna "Conta Principal": sempre exibe viewerCard (conta logada)
<td>
  <SharedAccountDisplay account={viewerCard} />
</td>

// Coluna "Contraparte": sempre exibe otherCard (outra conta)
<td>
  <SharedAccountDisplay account={otherCard} />
</td>
```

### Exemplo Prático

**Fechamento criado por Gustavo (account_id=1):**
- `main_account_card.total_to_receive` = 6067.29
- `main_account_card.total_to_pay` = 465.44
- `partner_account_card.total_to_receive` = 465.44
- `partner_account_card.total_to_pay` = 6067.29

**Exibição na Tabela:**

| Quem Logou | Coluna "Principal" | Coluna "Contraparte" | A Receber | A Pagar |
|------------|--------------------|-----------------------|-----------|---------|
| **Gustavo** | Gustavo (viewerCard) | Polezel (otherCard) | R$ 6.067,29 | -R$ 465,44 |
| **Polezel** | Polezel (viewerCard) | Gustavo (otherCard) | R$ 465,44 | -R$ 6.067,29 |

### Campos no JSON do Fechamento

| Campo | Descrição |
|-------|-----------|
| `total_to_receive` | Valor que a conta tem a receber |
| `total_to_pay` | Valor que a conta tem a pagar |
| `loan_to_receive` | Empréstimos a receber |
| `loan_to_pay` | Empréstimos a pagar |
| `net_balance` | Saldo líquido (calculado) |

### Justificativa

1. **Simplicidade**: Não há inversão de valores - apenas seleção do card correto
2. **Perspectiva do Usuário**: Cada usuário vê o card que representa sua perspectiva
3. **Consistência Visual**: A conta logada sempre aparece como "Conta Principal"
4. **Manutenção**: Os cards já vêm prontos do backend, sem necessidade de cálculos

