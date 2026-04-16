---
type: "always_apply"
---

# Regras de Desenvolvimento - Gus Expenses Platform

## Migrations de Banco de Dados

### Regra: Alterações de Schema no Migration 0001

**SEMPRE** que precisar fazer alterações em tabelas existentes:

1. **Modifique o Migration 0001** (`services/backend/scripts/migrations/0001_schema_inicial_multitenant.py`)
   - Corrija diretamente o `CREATE TABLE` com a estrutura desejada
   - **NÃO** crie migrations com `ALTER TABLE` para mudanças de schema
   - Exemplo: Se precisa mudar tipo de coluna ou reordenar colunas, edite o CREATE TABLE original

2. **Use Migration 0002 para Dados** (`services/backend/scripts/migrations/0002_*.py`)
   - Todos os `INSERT` de dados iniciais devem ir no migration 0002
   - Mesmo que o usuário não peça explicitamente por um novo migration
   - Exemplo: Inserir tags, subtags, cartões padrão, etc.

### Justificativa

- **Migration 0001**: Define a estrutura completa do banco (DDL - Data Definition Language)
- **Migration 0002+**: Popula dados iniciais e faz ajustes de dados (DML - Data Manipulation Language)
- Isso mantém o schema limpo e evita acúmulo de ALTER TABLE desnecessários

### Exemplos

#### ✅ CORRETO - Mudança de tipo de coluna
```python
# Migration 0001
CREATE TABLE credit_card_invoices (
    id SERIAL PRIMARY KEY,
    year_month VARCHAR(7) NOT NULL,
    date TIMESTAMP NOT NULL,  # ← Corrigido de DATE para TIMESTAMP
    ...
)
```

#### ❌ INCORRETO - Criar migration separada
```python
# Migration 0003 (NÃO FAZER!)
ALTER TABLE credit_card_invoices
ALTER COLUMN date TYPE TIMESTAMP;
```

#### ✅ CORRETO - Inserir dados iniciais
```python
# Migration 0002
INSERT INTO tags (tenant_id, name, type)
VALUES (1, 'Alimentação', 'despesa');
```

### Exceções

Crie um novo migration (0003, 0004, etc.) **APENAS** quando:
- O usuário pedir explicitamente
- For uma mudança estrutural complexa que não pode ser feita no 0001
- For uma migração de dados que depende de lógica complexa

---

## Atalhos de Teclado em Modais

### Regra: Sempre Implementar Atalhos ESC e Enter/Space

**SEMPRE** que criar ou modificar um modal/dialog, implemente os seguintes atalhos de teclado:

1. **ESC** - Fechar o modal (cancelar)
   - Deve chamar a função `onClose` ou equivalente
   - Mesmo comportamento do botão "X" ou "Cancelar"

2. **Enter** - Confirmar ação principal do modal
   - Deve submeter o formulário ou executar a ação principal
   - Mesmo comportamento do botão "Salvar", "Confirmar", "OK", etc.

3. **Space** - Alternativa para confirmar (opcional)
   - Pode ser usado como alternativa ao Enter em alguns casos

### Implementação

Use `useEffect` com event listener para capturar teclas:

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Submeter formulário ou executar ação principal
      handleSubmit()
    }
  }

  if (isOpen) {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }
}, [isOpen])
```

### Exceções

- **Enter em textarea**: Não submeter quando Shift+Enter (permitir quebra de linha)
- **Enter em campos de busca**: Pode ter comportamento específico
- **Modais de confirmação**: Enter deve confirmar, ESC deve cancelar

### Justificativa

- Melhora significativamente a UX
- Permite navegação rápida sem mouse
- Padrão esperado pelos usuários
- Acessibilidade

---

## Componentes Reutilizáveis

### Regra: Usar Componentes Genéricos ao Invés de Código Inline

**SEMPRE** que exibir informações que aparecem em múltiplas páginas, use componentes reutilizáveis:

### SharedAccountDisplay

**Arquivo**: `services/frontend/src/components/SharedAccountDisplay.tsx`

**Uso**: Exibir informações de conta compartilhada com modal de detalhes

**Páginas que usam**:
- `ExtratoPage.tsx` - Coluna "Compartilhamento" na tabela de transações
- `GrupoPage.tsx` - Coluna "Compartilhamento" nos itens agrupados
- `FaturasPage.tsx` - Coluna "Compartilhamento" na tabela de faturas
- `BalancoPage.tsx` - Coluna "Conta Contraparte" no modal de itens do fechamento
- `TransactionMappingsTab.tsx` - Coluna de conta compartilhada nos mapeamentos

**Interface**:
```typescript
interface SharedAccountDisplayProps {
  account: {
    id: number
    name?: string | null
    bank?: { name?: string; code?: string } | null
    agency?: string | number | null
    account_number?: string | number | null
  } | null | undefined
  ownershipPercentage?: number | null
  compact?: boolean
}
```

**Exemplo de uso**:
```tsx
<SharedAccountDisplay
  account={item.shared_partner_name ? {
    id: item.shared_partner_id || 0,
    name: item.shared_partner_name,
    bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
    agency: item.shared_partner_agency,
    account_number: item.shared_partner_account_number
  } : null}
  ownershipPercentage={item.ownership_percentage}
/>
```

**Funcionalidades**:
- Exibe nome da conta com ícone de informação
- Modal com detalhes: banco, agência (máscara `00001-0`), conta (máscara `000012345-6`)
- Percentual de contribuição
- Suporte a ESC para fechar modal
- Botão "Fechar" usa `--crud-cancel` CSS variable

### Justificativa

- **Manutenção**: Mudança em um lugar afeta todas as páginas
- **Consistência**: Mesmo visual e comportamento em toda a aplicação
- **DRY**: Evita duplicação de código

---

## Regras de UI Específicas

Para regras de UI específicas de páginas, consulte:

- **[balanco-ui.md](balanco-ui.md)** - Regras de UI da página de Balanço (estrutura de cards, CSS variables, layout, **lógica de inversão de perspectiva na aba Fechamentos**)
