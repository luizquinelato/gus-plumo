# Cores Universais

Sistema de cores universais para ações e estados do sistema, baseado no padrão do projeto Health Pulse.

## Conceito

**Cores Universais** são cores fixas que **nunca mudam**, independentemente do tema (light/dark) ou esquema de cores customizado (default/custom) do tenant. Elas garantem consistência visual para ações críticas do sistema.

## Diferença entre Cores Universais e Cores do Schema

| Tipo | Uso | Customizável | Exemplos |
|------|-----|--------------|----------|
| **Cores Universais** | Ações CRUD, Status do sistema | ❌ Não | Criar, Editar, Deletar, Cancelar |
| **Cores do Schema (1-5)** | Branding, dados valiosos, métricas | ✅ Sim | Gráficos, cards, destaques |

---

## Cores CRUD (Operações)

Cores para ações de **Create, Read, Update, Delete**:

```css
--crud-create: #0ea5e9;  /* Azul - Criar/Adicionar/Salvar/Importar */
--crud-edit: #0ea5e9;    /* Azul - Editar/Modificar */
--crud-delete: #dc2626;  /* Vermelho - Deletar/Remover */
--crud-cancel: #6b7280;  /* Cinza - Cancelar/Neutro */
```

### Uso Recomendado

| Ação | Cor | Exemplos |
|------|-----|----------|
| **Criar** | `--crud-create` (Azul) | Botão "Criar Lançamento", "Adicionar", "Salvar", "Importar" |
| **Editar** | `--crud-edit` (Azul) | Botão "Editar", "Modificar", ícone de lápis |
| **Deletar** | `--crud-delete` (Vermelho) | Botão "Excluir", "Remover", ícone de lixeira |
| **Cancelar** | `--crud-cancel` (Cinza) | Botão "Cancelar", "Fechar", "Voltar" |

---

## Cores de Status (Estados do Sistema)

Cores para feedback visual de estados do sistema:

```css
--status-success: #10b981;  /* Verde - Sucesso */
--status-warning: #f59e0b;  /* Amarelo - Aviso */
--status-error: #ef4444;    /* Vermelho - Erro */
--status-info: #3b82f6;     /* Azul - Informação */
```

### Uso Recomendado

| Estado | Cor | Exemplos |
|--------|-----|----------|
| **Sucesso** | `--status-success` | Mensagens de confirmação, ícones de check |
| **Aviso** | `--status-warning` | Alertas, avisos, atenção necessária |
| **Erro** | `--status-error` | Mensagens de erro, validações falhas |
| **Informação** | `--status-info` | Tooltips, dicas, informações gerais |

---

## Cores Neutras (Elementos Profissionais)

Cores para elementos neutros da interface:

```css
--neutral-primary: #374151;    /* Cinza escuro - Ações primárias neutras */
--neutral-secondary: #6b7280;  /* Cinza médio - Ações secundárias neutras */
--neutral-tertiary: #9ca3af;   /* Cinza claro - Elementos terciários */
```

### Uso Recomendado

| Nível | Cor | Exemplos |
|-------|-----|----------|
| **Primário** | `--neutral-primary` | Texto principal, ícones importantes |
| **Secundário** | `--neutral-secondary` | Texto secundário, ícones de suporte |
| **Terciário** | `--neutral-tertiary` | Texto desabilitado, placeholders |

---

## Exemplos de Código

### Botão de Criar (CRUD)

```tsx
<button
  className="px-4 py-2 rounded-lg text-white hover:opacity-90"
  style={{ backgroundColor: 'var(--crud-create)' }}
>
  Criar Lançamento
</button>
```

### Botão de Editar (CRUD)

```tsx
<button
  className="px-4 py-2 rounded-lg text-white hover:opacity-90"
  style={{ backgroundColor: 'var(--crud-edit)' }}
>
  Editar
</button>
```

### Mensagem de Sucesso (Status)

```tsx
<div
  className="p-4 rounded-lg text-white"
  style={{ backgroundColor: 'var(--status-success)' }}
>
  Operação realizada com sucesso!
</div>
```

### Mensagem de Erro (Status)

```tsx
<div
  className="p-4 rounded-lg text-white"
  style={{ backgroundColor: 'var(--status-error)' }}
>
  Erro ao processar a solicitação.
</div>
```

---

## Implementação no Projeto

### Arquivo CSS

As cores universais estão definidas em `services/frontend/src/index.css`:

```css
/* Universal System Colors - Never change regardless of theme/client */
:root {
  /* CRUD Operations - Universal Standards */
  --crud-create: #0ea5e9;  /* Azul - Criar/Adicionar/Salvar/Importar */
  --crud-edit: #0ea5e9;    /* Azul - Editar/Modificar */
  --crud-delete: #dc2626;  /* Vermelho - Deletar/Remover */
  --crud-cancel: #6b7280;  /* Cinza - Cancelar/Neutro */

  /* System Status - Universal Standards */
  --status-success: #10b981;  /* Verde - Sucesso */
  --status-warning: #f59e0b;  /* Amarelo - Aviso */
  --status-error: #ef4444;    /* Vermelho - Erro */
  --status-info: #3b82f6;     /* Azul - Informação */

  /* Enterprise Neutrals - Professional UI Elements */
  --neutral-primary: #374151;
  --neutral-secondary: #6b7280;
  --neutral-tertiary: #9ca3af;
}
```

---

## Referência

Este sistema foi baseado no projeto **Health Pulse** (`C:\Workspace\health-pulse\services\frontend-app\src\index.css`), que implementa um padrão enterprise de cores universais para garantir consistência visual em aplicações multi-tenant.

