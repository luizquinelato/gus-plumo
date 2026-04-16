# Banco de Dados

Estrutura do banco de dados PostgreSQL 17 com suporte multi-tenant.

## Configuração

### PostgreSQL 17
- Instância única com volumes Docker persistentes
- Suporte a múltiplos ambientes (dev/prod) via variáveis de ambiente

### Conexão (Produção)
```
Host: localhost
Port: 5432
Database: expenses_db
User: postgres
```

### Conexão (Desenvolvimento)
```
Host: localhost
Port: 5433
Database: expenses_db_dev
User: postgres
```

> **Veja também**: [ambientes.md](ambientes.md) para detalhes sobre configuração de ambientes e scripts de database.

## Estrutura Multi-tenant

### BaseEntity (Entidade Base)

Todas as tabelas herdam de `BaseEntity` que possui:

```python
id: int                 # Chave primária (auto-incremento)
tenant_id: int          # Isolamento de dados por tenant/organização
created_by: int         # ID do usuário que criou o registro
created_at: datetime    # Data de criação
last_updated_at: datetime  # Data de última atualização
```

**IMPORTANTE**: O campo `active` **NÃO** está no `BaseEntity`. Apenas algumas tabelas específicas possuem este campo para soft delete.

### AccountBaseEntity (Entidade Base com Conta)

Algumas tabelas herdam de `AccountBaseEntity` (que herda de `BaseEntity`) e adicionam:

```python
account_id: int         # ID da conta (vem ANTES de tenant_id na ordem das colunas)
# ... demais campos do BaseEntity
```

### Tabelas COM campo `active` (Soft Delete)

Estas tabelas usam exclusão lógica (soft delete):
- `tenants`
- `users`
- `accounts`
- `banks`
- `expense_sharing_settings`
- `credit_cards` (Cartao)
- `users_sessions`
- `users_permissions`
- `system_settings`
- `tenants_colors`

### Tabelas SEM campo `active` (Hard Delete)

Estas tabelas usam exclusão física (hard delete):
- `bank_statements`
- `credit_card_invoices`
- `benefit_card_statements`
- `tags`
- `subtags`
- `transaction_mappings`

## Tabelas Principais

### credit_cards

Cartões de crédito e cartões de benefícios cadastrados.

```sql
CREATE TABLE credit_cards (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    number VARCHAR(4) NOT NULL,           -- Últimos 4 dígitos
    name VARCHAR(100) NOT NULL,           -- Nome do cartão/titular
    type VARCHAR(20) NOT NULL,            -- "credito" ou "beneficios"
    brand VARCHAR(50),                    -- Visa, Mastercard, etc.
    limit_amount DECIMAL(10,2),           -- Limite do cartão
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_credit_cards_tenant ON credit_cards(tenant_id);
CREATE INDEX idx_credit_cards_number ON credit_cards(number);
CREATE INDEX idx_credit_cards_type ON credit_cards(type);
```

### credit_card_invoices

Lançamentos de faturas de cartão de crédito.

**IMPORTANTE**: Esta tabela **NÃO** possui campo `active` (usa hard delete).

```sql
CREATE TABLE credit_card_invoices (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    credit_card_id INTEGER REFERENCES credit_cards(id),
    year_month VARCHAR(7) NOT NULL,       -- "2025-01"
    date TIMESTAMP NOT NULL,              -- Data da transação
    description TEXT NOT NULL,            -- Descrição da compra
    amount DECIMAL(10,2) NOT NULL,        -- Valor (negativo para despesa)
    subtag_id INTEGER REFERENCES subtags(id),
    parcelado BOOLEAN DEFAULT FALSE,      -- É parcelado?
    parcela_paga INTEGER,                 -- Parcela atual (ex: 3)
    total_parcelas INTEGER,               -- Total de parcelas (ex: 12)
    ownership_percentage DECIMAL(5,2),    -- Percentual de propriedade (0-100)
    expense_sharing_id INTEGER REFERENCES expense_sharing_settings(id),
    third_party_user_id INTEGER REFERENCES third_party_users(id),
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant ON credit_card_invoices(tenant_id);
CREATE INDEX idx_invoices_card ON credit_card_invoices(credit_card_id);
CREATE INDEX idx_invoices_date ON credit_card_invoices(date);
CREATE INDEX idx_invoices_subtag ON credit_card_invoices(subtag_id);
CREATE INDEX idx_invoices_expense_sharing ON credit_card_invoices(expense_sharing_id);
CREATE INDEX idx_invoices_third_party ON credit_card_invoices(third_party_user_id);
```

**Nota**: `adjustment_type` é derivado automaticamente:
- `proprio`: quando `expense_sharing_id IS NULL AND third_party_user_id IS NULL`
- `compartilhado`: quando `expense_sharing_id IS NOT NULL`
- `terceiro`: quando `third_party_user_id IS NOT NULL`

### bank_statements

Lançamentos de extratos bancários.

**IMPORTANTE**: Esta tabela **NÃO** possui campo `active` (usa hard delete).

```sql
CREATE TABLE bank_statements (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    date TIMESTAMP NOT NULL,              -- Data da transação
    description TEXT NOT NULL,            -- Descrição
    amount DECIMAL(10,2) NOT NULL,        -- Valor (positivo=receita, negativo=despesa)
    category VARCHAR(100),                -- Categoria original do banco
    transaction VARCHAR(50),              -- Tipo de transação
    subtag_id INTEGER REFERENCES subtags(id),
    ownership_percentage DECIMAL(5,2),    -- Percentual de propriedade (0-100)
    expense_sharing_id INTEGER REFERENCES expense_sharing_settings(id),
    third_party_user_id INTEGER REFERENCES third_party_users(id),
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_statements_tenant ON bank_statements(tenant_id);
CREATE INDEX idx_statements_date ON bank_statements(date);
CREATE INDEX idx_statements_subtag ON bank_statements(subtag_id);
CREATE INDEX idx_statements_expense_sharing ON bank_statements(expense_sharing_id);
CREATE INDEX idx_statements_third_party ON bank_statements(third_party_user_id);
```

**Nota**: `adjustment_type` é derivado automaticamente (mesma lógica de `credit_card_invoices`).

### tags

Categorias principais (Alimentação, Transporte, etc.).

**Importante**:
- Tags **não têm** coluna `type`. O tipo está nas subtags.
- Tags **NÃO** possuem campo `active` (usa hard delete).

```sql
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,           -- "Alimentação", "Transporte"
    description TEXT,                     -- Descrição opcional
    icon VARCHAR(50) DEFAULT 'Tag',       -- Ícone opcional
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tags_tenant ON tags(tenant_id);
```

### subtags

Subcategorias (Supermercado, Restaurante, etc.).

**Importante**:
- Subtags **têm** coluna `type` ('receita' ou 'despesa').
- Subtags **NÃO** possuem campo `active` (usa hard delete).

```sql
CREATE TABLE subtags (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    tag_id INTEGER REFERENCES tags(id),
    name VARCHAR(100) NOT NULL,           -- "Supermercado", "Restaurante"
    description TEXT,                     -- Descrição opcional
    type VARCHAR(20) NOT NULL,            -- "receita" ou "despesa"
    icon VARCHAR(50) DEFAULT 'Tags',      -- Ícone opcional
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subtags_tenant ON subtags(tenant_id);
CREATE INDEX idx_subtags_tag ON subtags(tag_id);
CREATE INDEX idx_subtags_type ON subtags(type);
```

### benefit_card_statements

Lançamentos de cartões de benefícios (ex: Flash, VR, VA).

**IMPORTANTE**: Esta tabela **NÃO** possui campo `active` (usa hard delete).

```sql
CREATE TABLE benefit_card_statements (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    credit_card_id INTEGER REFERENCES credit_cards(id),
    date TIMESTAMP NOT NULL,              -- Data e hora da transação (padronizado com bank_statements)
    description TEXT NOT NULL,            -- Descrição da compra
    amount DECIMAL(10,2) NOT NULL,        -- Valor da transação
    payment_method VARCHAR(100),          -- Meio de pagamento
    subtag_id INTEGER REFERENCES subtags(id),
    ownership_percentage DECIMAL(5,2),    -- Percentual de propriedade (0-100)
    expense_sharing_id INTEGER REFERENCES expense_sharing_settings(id),
    third_party_user_id INTEGER REFERENCES third_party_users(id),
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_benefit_statements_tenant ON benefit_card_statements(tenant_id);
CREATE INDEX idx_benefit_statements_card ON benefit_card_statements(credit_card_id);
CREATE INDEX idx_benefit_statements_date ON benefit_card_statements(date);
CREATE INDEX idx_benefit_statements_subtag ON benefit_card_statements(subtag_id);
CREATE INDEX idx_benefit_statements_expense_sharing ON benefit_card_statements(expense_sharing_id);
CREATE INDEX idx_benefit_statements_third_party ON benefit_card_statements(third_party_user_id);
```

**Nota**: `adjustment_type` é derivado automaticamente (mesma lógica das outras tabelas de transações).

### expense_sharing_settings

Configurações de compartilhamento de despesas entre contas do mesmo tenant.

**IMPORTANTE**: Esta tabela possui campo `active` (usa soft delete).

```sql
CREATE TABLE expense_sharing_settings (
    id SERIAL PRIMARY KEY,
    shared_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    my_contribution_percentage DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    description TEXT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_expense_sharing_account ON expense_sharing_settings(account_id);
CREATE INDEX idx_expense_sharing_shared_account ON expense_sharing_settings(shared_account_id);
CREATE INDEX idx_expense_sharing_tenant ON expense_sharing_settings(tenant_id);
```

**Conceito**: Cada conta configura seus próprios compartilhamentos de forma independente. Não há duplicação de registros (A→B e B→A).

**Percentual de Contribuição (`my_contribution_percentage`)**:
- `0%`: Outra conta paga 100% (terceiro paga tudo)
- `50%`: Compartilhado meio a meio
- `100%`: Eu pago 100%

**Exemplo**: Se Gustavo compartilha com Polezel 50/50, apenas Gustavo cria um registro com `my_contribution_percentage = 50`. Polezel não precisa criar registro reverso.

**IMPORTANTE - Percentual Individual vs Padrão**:
- `expense_sharing_settings.my_contribution_percentage`: Percentual **PADRÃO** usado ao criar novas transações
- `bank_statements.ownership_percentage`: Percentual **ESPECÍFICO** desta transação individual
- `credit_card_invoices.ownership_percentage`: Percentual **ESPECÍFICO** desta transação individual
- `benefit_card_statements.ownership_percentage`: Percentual **ESPECÍFICO** desta transação individual

**Regra de Cálculo**: Sempre use o `ownership_percentage` da transação individual nos cálculos de balanço, NÃO o percentual padrão do `expense_sharing_settings`. Cada transação pode ter um percentual diferente do padrão.

### transaction_mappings

Mapeamentos de descrições de transações para tags/subtags.

**IMPORTANTE**: Esta tabela **NÃO** possui campo `active` (usa hard delete).

```sql
CREATE TABLE transaction_mappings (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,          -- ID da conta (vem ANTES de tenant_id)
    tenant_id INTEGER NOT NULL,
    original_description TEXT,            -- Para exact match: "netflix" (lowercase)
    pattern TEXT,                         -- Para pattern match: "uber" (case-insensitive)
    regex_pattern TEXT,                   -- Para regex match: "^pix.*[0-9]{8,}$"
    mapped_description TEXT,              -- "Streaming Netflix" (opcional)
    subtag_id INTEGER REFERENCES subtags(id),
    mapping_type VARCHAR(20) NOT NULL,    -- 'exact', 'pattern', 'regex'
    priority INTEGER DEFAULT 10,          -- Prioridade (maior = testado primeiro)
    is_sensitive BOOLEAN DEFAULT FALSE,   -- Se contém dados sensíveis
    created_by INTEGER NOT NULL,          -- ID do usuário que criou
    created_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mappings_tenant ON transaction_mappings(tenant_id);
CREATE INDEX idx_mappings_description ON transaction_mappings(LOWER(original_description));
CREATE INDEX idx_mappings_subtag ON transaction_mappings(subtag_id);
```

### tenant_colors

Cores personalizadas por tenant.

```sql
CREATE TABLE tenant_colors (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    mode VARCHAR(20) NOT NULL,            -- "default" ou "custom"
    theme VARCHAR(20) NOT NULL,           -- "light" ou "dark"
    accessibility VARCHAR(20) NOT NULL,   -- "regular", "AA", "AAA"
    color_1 VARCHAR(7) NOT NULL,          -- Hex color
    color_2 VARCHAR(7) NOT NULL,
    color_3 VARCHAR(7) NOT NULL,
    color_4 VARCHAR(7) NOT NULL,
    color_5 VARCHAR(7) NOT NULL,
    color_6 VARCHAR(7) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(tenant_id, mode, theme, accessibility)
);

CREATE INDEX idx_colors_tenant ON tenant_colors(tenant_id);
CREATE INDEX idx_colors_mode_theme ON tenant_colors(mode, theme, accessibility);
```

## Relacionamentos

```
tenant_colors
    └── tenant_id

credit_cards
    └── tenant_id
    
credit_card_invoices
    ├── tenant_id
    ├── credit_card_id → credit_cards.id
    └── subtag_id → subtags.id

bank_statements
    ├── tenant_id
    └── subtag_id → subtags.id

tags
    └── tenant_id

subtags
    ├── tenant_id
    └── tag_id → tags.id

transaction_mappings
    ├── tenant_id
    └── subtag_id → subtags.id
```

## Migrations

### 0001_schema_inicial_multitenant.py

Cria estrutura inicial do banco:
- Tabelas principais
- Índices
- Constraints

### 0002_dados_iniciais.py

Popula dados iniciais:
- Tags padrão (Alimentação, Transporte, etc.)
- Subtags padrão (Supermercado, Restaurante, etc.)
- Cores padrão (light/dark)

### 0003_add_accessibility_levels.py

Adiciona níveis de acessibilidade:
- Cria registros AA e AAA para cores
- Ajusta contraste conforme WCAG 2.1

## Queries Comuns

### Buscar registros não mapeados

```sql
SELECT * FROM bank_statements
WHERE tenant_id = 1
  AND account_id = 1
  AND subtag_id IS NULL
ORDER BY date DESC;
```

**Nota**: `bank_statements` não possui campo `active`, então não é necessário filtrar por ele.

### Buscar mapeamento por descrição

```sql
-- Exact match
SELECT * FROM transaction_mappings
WHERE tenant_id = 1
  AND account_id = 1
  AND mapping_type = 'exact'
  AND LOWER(original_description) = LOWER('netflix')
LIMIT 1;

-- Pattern match
SELECT * FROM transaction_mappings
WHERE tenant_id = 1
  AND account_id = 1
  AND mapping_type = 'pattern'
  AND LOWER('uber trip 1234') LIKE '%' || LOWER(pattern) || '%'
ORDER BY priority DESC, LENGTH(pattern) DESC
LIMIT 1;

-- Regex match
SELECT * FROM transaction_mappings
WHERE tenant_id = 1
  AND account_id = 1
  AND mapping_type = 'regex'
  AND 'pix enviado abc12345' ~* regex_pattern
ORDER BY priority DESC
LIMIT 1;
```

**Nota**: `transaction_mappings` não possui campo `active`, então não é necessário filtrar por ele.

### Listar despesas por categoria

```sql
SELECT
  t.name AS tag,
  s.name AS subtag,
  SUM(b.amount) AS total
FROM bank_statements b
JOIN subtags s ON b.subtag_id = s.id
JOIN tags t ON s.tag_id = t.id
WHERE b.tenant_id = 1
  AND b.account_id = 1
  AND b.amount < 0
  AND b.date >= '2025-01-01'
  AND b.date < '2025-02-01'
GROUP BY t.name, s.name
ORDER BY total;
```

**Nota**: `bank_statements` não possui campo `active`, então não é necessário filtrar por ele.

### Buscar cores customizadas

```sql
SELECT * FROM tenant_colors
WHERE tenant_id = 1
  AND mode = 'custom'
  AND theme = 'light'
  AND accessibility = 'AA'
  AND active = TRUE;
```

