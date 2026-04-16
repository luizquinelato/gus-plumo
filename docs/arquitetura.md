# Arquitetura - Gus Expenses Platform

Sistema de gerenciamento de despesas pessoais com importação automatizada de extratos bancários e faturas de cartão de crédito.

## Stack Tecnológica

```
Frontend: React + TypeScript + Vite + TailwindCSS
Backend:  FastAPI + Python 3.11
Database: PostgreSQL 17 (Primary + Replica)
```

## Estrutura de Diretórios

```
gus-expenses-platform/
├── services/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── routers/          # Endpoints da API
│   │   │   ├── services/         # Lógica de negócio
│   │   │   ├── models/           # Modelos SQLAlchemy
│   │   │   ├── utils/            # Utilitários
│   │   │   └── etl/              # Pipeline ETL
│   │   └── scripts/
│   │       └── migrations/       # Migrations do banco
│   └── frontend/
│       └── src/
│           ├── pages/            # Páginas da aplicação
│           ├── components/       # Componentes reutilizáveis
│           ├── hooks/            # React hooks
│           └── services/         # Serviços de API
└── docs/                         # Documentação
```

## Componentes Principais

### Backend

**Routers** (`app/routers/`)
- `import_router.py` - Importação de extratos e faturas
- `expenses_router.py` - Gestão de despesas, tags e mapeamentos
- `cartoes_router.py` - CRUD de cartões de crédito
- `colors_router.py` - Sistema de cores personalizadas

**Services** (`app/services/`)
- `FaturaService` - Processamento de faturas de cartão
- `ExtratoService` - Processamento de extratos bancários
- `ColorCalculationService` - Cálculos de cores e acessibilidade

**ETL** (`app/etl/`)
- `ExtratoExtractor` - Extração de dados de Excel
- `ExtratoTransformer` - Transformação e normalização
- `ExtratoLoader` - Persistência no banco

**Models** (`app/models/`)
- `Cartao` - Cartões de crédito
- `CreditCardInvoice` - Faturas de cartão
- `BankStatement` - Extratos bancários
- `Tag` / `Subtag` - Sistema de categorização
- `TransactionMapping` - Mapeamentos de descrições

### Frontend

**Pages** (`src/pages/`)
- `HomePage.tsx` - Dashboard e importação
- `CartoesPage.tsx` - Gestão de cartões
- `CuradoriaPage.tsx` - Categorização de registros
- `MapeamentosPage.tsx` - Gestão de mapeamentos

**Components** (`src/components/`)
- `Sidebar.tsx` - Menu lateral
- `UnifiedImportModal.tsx` - Modal de importação unificado
- `UnmappedRecordsModal.tsx` - Modal de curadoria
- `ColorCustomizerUnified.tsx` - Editor de cores

**Hooks** (`src/hooks/`)
- `useColorData.ts` - Gerenciamento de cores
- `useAlert.ts` - Sistema de notificações

## Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│                    React + TypeScript                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/REST
┌──────────────────────▼──────────────────────────────────────┐
│                      Backend API                             │
│                      FastAPI                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Routers   │  │  Services  │  │    ETL     │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQLAlchemy
┌──────────────────────▼──────────────────────────────────────┐
│                   PostgreSQL 17                              │
│              Primary + Replica (Streaming)                   │
└─────────────────────────────────────────────────────────────┘
```

## Banco de Dados

### Multi-tenant com Hierarquia de Contas

**Hierarquia**: Tenant → Users → Accounts

Todas as tabelas herdam de `BaseEntity`:
- `id` - Chave primária
- `tenant_id` - Isolamento de dados por tenant/organização
- `created_by` - ID do usuário que criou o registro
- `created_at` / `last_updated_at` - Auditoria

Algumas tabelas herdam de `AccountBaseEntity` (adiciona `account_id`):
- `account_id` - ID da conta (configurações são por conta, não por tenant)
- Exemplos: `tags`, `subtags`, `transaction_mappings`, `bank_statements`, `credit_card_invoices`

**IMPORTANTE**: O campo `active` **NÃO** está no `BaseEntity`. Apenas algumas tabelas específicas possuem este campo para soft delete (ex: `users`, `accounts`, `credit_cards`).

### Principais Tabelas

- `credit_cards` - Cartões de crédito cadastrados
- `credit_card_invoices` - Lançamentos de faturas
- `bank_statements` - Lançamentos de extratos bancários
- `tags` - Categorias principais (Alimentação, Transporte, etc.)
- `subtags` - Subcategorias (Supermercado, Restaurante, etc.)
- `transaction_mappings` - Mapeamento de descrições para tags
- `tenant_colors` - Cores personalizadas por tenant

## Funcionalidades Principais

### 1. Importação de Extratos Bancários
- Upload de arquivo Excel (.xlsx)
- Pipeline ETL (Extract → Transform → Load)
- Mapeamento automático de categorias
- Detecção de duplicatas

### 2. Importação de Faturas de Cartão
- Upload de PDF + ano/mês
- Conversão PDF → TXT
- Extração de dados com regex
- Cálculo inteligente de datas (considera parcelas)
- Mapeamento automático de categorias

### 3. Sistema de Curadoria
- Listagem de registros não categorizados
- Agrupamento por descrição
- Categorização em lote
- Criação automática de mapeamentos

### 4. Sistema de Mapeamentos
- Mapeamento de descrições para tags/subtags
- Aplicação automática em importações futuras
- Descrições personalizadas (ofuscação)
- Ícones personalizados

### 5. Sistema de Cores
- 3 níveis de acessibilidade (Regular, AA, AAA)
- Suporte a temas light/dark
- Cálculo automático de variantes
- Cache inteligente com localStorage

