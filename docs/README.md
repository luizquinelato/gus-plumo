# Documentação - Gus Expenses Platform

Sistema de gerenciamento de despesas pessoais com importação automatizada de extratos bancários e faturas de cartão de crédito.

## 📚 Documentação

### Arquitetura
- [**arquitetura.md**](arquitetura.md) - Visão geral da arquitetura, stack tecnológica e componentes principais

### Funcionalidades
- [**importacao.md**](importacao.md) - Sistema de importação de extratos e faturas (ETL, parsers, mapeamentos)
- [**categorizacao.md**](categorizacao.md) - Sistema de categorização (tags, subtags, mapeamentos automáticos)
- [**cores.md**](cores.md) - Sistema de cores personalizadas (acessibilidade, temas, variantes)

### Banco de Dados
- [**banco-de-dados.md**](banco-de-dados.md) - Estrutura do banco, tabelas, relacionamentos e queries

### Infraestrutura
- [**ambientes.md**](ambientes.md) - Configuração de ambientes (dev/prod), scripts de database

## 🚀 Quick Start

### 1. Rodar Migrations

```bash
# Migration 0001: Schema inicial
python -m services.backend.scripts.migrations.0001_schema_inicial_multitenant

# Migration 0002: Dados iniciais
python -m services.backend.scripts.migrations.0002_dados_iniciais

# Migration 0003: Níveis de acessibilidade
python -m services.backend.scripts.migrations.0003_add_accessibility_levels
```

### 2. Iniciar Backend

```bash
cd services/backend
uvicorn app.main:app --reload --port 8000
```

### 3. Iniciar Frontend

```bash
cd services/frontend
npm run dev
```

### 4. Acessar Aplicação

```
http://localhost:5173
```

## 🏗️ Arquitetura

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
│              (Docker com volumes persistentes)               │
└─────────────────────────────────────────────────────────────┘
```

## � Funcionalidades Principais

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

### 6. Relatórios e Análises
- Série temporal de gastos (receitas vs despesas)
- Granularidade automática (diária < 30 dias, mensal ≥ 30 dias)
- Análise por categoria e subcategoria
- Filtros por período, fonte (banco/cartões) e tags
- Gráficos interativos (linha e barra)
- Indicadores de tendência (crescimento/queda)

## 🗄️ Banco de Dados

### Principais Tabelas

- `credit_cards` - Cartões de crédito cadastrados
- `credit_card_invoices` - Lançamentos de faturas
- `bank_statements` - Lançamentos de extratos bancários
- `tags` - Categorias principais (Alimentação, Transporte, etc.)
- `subtags` - Subcategorias (Supermercado, Restaurante, etc.)
- `transaction_mappings` - Mapeamento de descrições para tags
- `tenant_colors` - Cores personalizadas por tenant

### Multi-tenant

Todas as tabelas herdam de `BaseEntity`:
- `tenant_id` - Isolamento de dados por usuário/organização
- `created_by` - ID do usuário que criou o registro
- `created_at` / `last_updated_at` - Auditoria

**Nota**: O campo `active` NÃO está no `BaseEntity`. Apenas algumas tabelas específicas possuem este campo para soft delete (ex: `users`, `accounts`, `credit_cards`).

## 🔑 Endpoints Principais

### Importação
- `POST /api/import/extrato` - Importa extrato bancário
- `POST /api/import/fatura` - Importa fatura de cartão

### Despesas
- `GET /api/expenses/tags` - Lista tags
- `GET /api/expenses/subtags` - Lista subtags
- `GET /api/expenses/mappings` - Lista mapeamentos
- `GET /api/expenses/unmapped-records` - Lista registros não mapeados
- `PATCH /api/expenses/bulk-update-subtags` - Atualiza subtags em lote

### Cores
- `GET /api/colors/unified` - Busca cores (modo, tema, acessibilidade)
- `POST /api/colors/custom` - Salva cores customizadas

### Cartões
- `GET /api/cartoes` - Lista cartões
- `POST /api/cartoes` - Cria cartão
- `PUT /api/cartoes/{id}` - Atualiza cartão
- `DELETE /api/cartoes/{id}` - Exclui cartão

### Relatórios
- `GET /api/reports/time-series` - Série temporal de gastos (granularidade automática)
- `GET /api/reports/detailed` - Relatório detalhado com transações
- `GET /api/reports/by-tag` - Análise por categoria
- `GET /api/reports/by-subtag` - Análise por subcategoria

**Granularidade Automática**:
- Períodos < 30 dias → granularidade **diária** (labels: DD/MM)
- Períodos ≥ 30 dias → granularidade **mensal** (labels: MMM/YYYY)

**Filtros Padrão**:
- **Mês Atual**: Início do mês até hoje
- **Ano Corrente**: Início do ano até hoje
- **Últimos 3/6 Meses**: N meses atrás até hoje
- **Últimos 5 Anos**: 5 anos atrás até hoje
- **Customizado**: Período específico com datas

## 🛠️ Ferramentas de Desenvolvimento

### PowerShell Helpers

Comandos úteis para desenvolvimento:

```powershell
# Rodar backend
backend

# Rodar frontend
frontend

# Rodar migrations
migrate

# Acessar banco de dados
db
```

**Documentação**: [powershell-helpers/README.md](powershell-helpers/README.md)

## 📖 Leia Mais

- [Arquitetura](arquitetura.md) - Detalhes da arquitetura e componentes
- [Importação](importacao.md) - Como funciona o sistema de importação
- [Categorização](categorizacao.md) - Sistema de tags, subtags e mapeamentos
- [Cores](cores.md) - Sistema de cores personalizadas
- [Banco de Dados](banco-de-dados.md) - Estrutura do banco e queries

