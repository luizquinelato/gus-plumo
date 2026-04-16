# Sistema de Categorização

Sistema completo de categorização de despesas e receitas com tags, subtags e mapeamentos automáticos.

## Estrutura de Categorização

```
Tag (Categoria Principal)
└── Subtag (Subcategoria)
    └── Registro (Despesa/Receita)
```

### Exemplo

```
Alimentação (Tag)
├── Supermercado (Subtag)
│   ├── CARREFOUR - R$ 234,50
│   └── EXTRA - R$ 156,80
└── Restaurante (Subtag)
    ├── OUTBACK - R$ 89,90
    └── MCDONALDS - R$ 34,50
```

## Tags e Subtags

### Modelo de Dados

**Tag** (Categoria Principal - Genérica)
```python
class Tag(Base):
    id: int
    tenant_id: int
    name: str              # "Alimentação", "Transporte", etc.
    description: str       # Descrição opcional
    icon: str              # Ícone opcional (default: 'Tag')
    active: bool
```

**Importante**: Tags **não têm** coluna `type`. Uma tag pode ter subtags de receita E despesa.

**Subtag** (Subcategoria - Específica)
```python
class Subtag(Base):
    id: int
    tenant_id: int
    tag_id: int            # FK para Tag
    name: str              # "Supermercado", "Restaurante", etc.
    type: str              # "receita" ou "despesa"
    icon: str | None       # Ícone opcional
    active: bool
```

**Importante**: Subtags **têm** coluna `type` que define se é receita ou despesa.

### Tags Padrão

**Despesas**
- Alimentação → Supermercado, Restaurante, Delivery, Padaria, Açougue, Feira
- Transporte → Combustível, Uber, Estacionamento, Manutenção, IPVA
- Moradia → Aluguel, Condomínio, Água, Luz, Gás, Internet, Manutenção
- Saúde & Bem estar → Farmácia, Fono, Dentista, Estética & Cosmético, Pediatra, Plano de Saúde, Terapia, Cabelo, Consulta
- Lazer → Aposta, Ensaio & Fotografia, Esporte, Festa & Entretenimento, Game, Viagem & Passeio
- Educação → Cursos, Livros, Papelaria
- Vestuário → Roupas, Calçados, Acessórios
- Governo → Cartório, IPTU, IPVA, Imposto
- Banco → Tarifa, Juro, Mora

**Receitas**
- Trabalho → Salário, PLR
- Investimentos → Dividendos, Rendimentos
- Governo → Restituição IRPF, Reembolso
- Saúde & Bem estar → Reembolso
- Lazer → Prêmio
- Receita Geral → Empréstimo, Venda, Presente

**Geral** (Categoria Unificada)
- Geral → Transferência, Empréstimo, Venda, Presente, Outro (receita e despesa)

## Sistema de Mapeamentos

Mapeamentos automáticos de descrições para tags/subtags com suporte a **exact match**, **pattern** e **regex**.

### Modelo de Dados

```python
class TransactionMapping(Base):
    id: int
    tenant_id: int
    user_id: int | None

    # Campos de mapeamento (apenas um é usado por vez)
    original_description: str | None  # Para exact match: "netflix" (lowercase)
    pattern: str | None               # Para pattern: "uber" (case-insensitive)
    regex_pattern: str | None         # Para regex: "^pix.*[0-9]{8,}$"

    mapped_description: str | None    # "Streaming Netflix" (opcional, para ofuscação)
    subtag_id: int                    # FK para Subtag
    mapping_type: str                 # 'exact', 'pattern', 'regex'
    priority: int                     # Prioridade (maior = testado primeiro)
    is_sensitive: bool                # Se contém dados sensíveis (criptografado)
    active: bool
    created_at: datetime
    last_updated_at: datetime
```

### Tipos de Mapeamento

#### 1. **Exact Match** (Correspondência Exata)
- Compara descrição completa (case-insensitive)
- Mais rápido e preciso
- **Exemplo**: `original_description = "netflix"` → captura apenas "NETFLIX", "Netflix", "netflix"

#### 2. **Pattern Match** (Padrão de Texto)
- Busca substring dentro da descrição (case-insensitive)
- Útil para descrições variáveis
- **Exemplo**: `pattern = "uber"` → captura "UBER *TRIP 1234", "uber eats", "UBER VIAGEM"

#### 3. **Regex Match** (Expressão Regular)
- Usa regex para correspondência avançada (case-insensitive)
- Mais flexível, mas mais lento
- **Exemplo**: `regex_pattern = "^pix.*[0-9]{8,}$"` → captura "PIX ENVIADO abc12345"

### Sistema de Prioridades

**Ordem de Matching** (3 níveis hierárquicos):

```python
# 1️⃣ EXACT MATCH (sempre testado primeiro, mais rápido)
if exact_match_found:
    return mapping

# 2️⃣ PATTERN MATCH (ordenado por prioridade DESC, depois por tamanho DESC)
patterns_sorted = sorted(patterns, key=lambda m: (m.priority, len(m.pattern)), reverse=True)
for pattern in patterns_sorted:
    if pattern in description:
        return mapping

# 3️⃣ REGEX MATCH (ordenado por prioridade DESC)
regex_sorted = sorted(regex_mappings, key=lambda m: m.priority, reverse=True)
for regex in regex_sorted:
    if regex.match(description):
        return mapping
```

**Campo `priority`**:
- Valor padrão: **10** (criado na Curadoria)
- Maior prioridade = testado primeiro (dentro do mesmo tipo)
- Permite criar mapeamentos mais específicos com prioridade maior
- **Exemplo**:
  - Pattern `uber` (prioridade 10) → Transporte
  - Pattern `uber eats` (prioridade 15) → Alimentação
  - Descrição "uber eats pedido 123" → **Alimentação** (prioridade 15 vence)

### Funcionamento

#### 1. Criação de Mapeamento

**Origem**: Página de Curadoria ou Transaction Mappings

**Processo**:
```python
# Exact Match
mapping = TransactionMapping(
    original_description="netflix",  # lowercase
    mapping_type="exact",
    subtag_id=15,
    priority=0
)

# Pattern Match
mapping = TransactionMapping(
    pattern="uber",  # case-insensitive
    mapping_type="pattern",
    subtag_id=20,
    priority=10
)

# Regex Match
mapping = TransactionMapping(
    regex_pattern="^pix.*[0-9]{8,}$",
    mapping_type="regex",
    subtag_id=25,
    priority=10
)
```

#### 2. Aplicação em Importações

**Ordem de Prioridade**:

```python
# PRIORIDADE 1: Mapeamento do usuário (exact → pattern → regex)
mapping = mapping_helper.find_mapping(description)

if mapping:
    subtag_id = mapping.subtag_id

# PRIORIDADE 2: Parser (regras hardcoded)
elif 'Tag' in row and 'Subtag' in row:
    subtag_id = buscar_subtag_id(tag_nome, subtag_nome)

# PRIORIDADE 3: Fallback
else:
    subtag_id = get_default_subtag_id()  # "Não Categorizado → Pendente"
```

### Descrições Personalizadas (Ofuscação)

Permite substituir descrições sensíveis por nomes genéricos.

**Exemplo**:
```python
# Original: "BADOO PREMIUM"
# Mapeado: "Entretenimento"

mapping = TransactionMapping(
    original_description="badoo premium",
    mapped_description="Entretenimento",  # ← Aparece nos relatórios
    subtag_id=20
)
```

**Resultado**:
- Importação: "BADOO PREMIUM" → Salvo como "BADOO PREMIUM"
- Exibição: Mostra "Entretenimento" (se `mapped_description` existir)

## Página de Curadoria

Interface para categorizar registros não mapeados.

### Acesso
- Menu lateral: "Curadoria"
- Modal pós-importação: Botão "Ir para Curadoria"

### Funcionalidades

#### 1. Listagem de Registros Não Mapeados

**Endpoint**: `GET /api/expenses/unmapped-records`

**Critérios**:
- `subtag_id IS NULL` (registros sem categorização)

**Fontes de Dados**:
- `bank_statements` (extratos bancários)
- `credit_card_invoices` (faturas de cartão)
- `benefit_card_statements` (cartões de benefícios)

**Agrupamento**:
- **Cartão de Crédito**: Agrupados por `year_month` (mês da fatura)
- **Banco**: Agrupados por `date` (data da transação)
- **Cartão de Benefícios**: Agrupados por `description` (descrição)
- Mostra quantidade de registros por grupo
- Exibe informações de parcelamento (quando aplicável)

**Busca por Descrição**:
- Campo de busca localizado logo acima da tabela
- Filtra registros em tempo real pela descrição
- Mostra contador de registros filtrados
- Reseta para a primeira página ao buscar
- **Importante**: Botões "Aplicar a Todos" aplicam apenas aos registros filtrados visíveis na página atual

**Formato de Tabela**:
- Qtd: Número de registros no grupo
- Tipo: Receita (🟢) ou Despesa (🔴)
- Valor: Soma total do grupo
- Descrição: Descrição comum dos registros
- Tag: Dropdown para selecionar tag
- Subtag: Dropdown para selecionar subtag (filtrado pela tag)
- Mapear: Checkbox para criar mapeamento automático
- Ações: Botões de Aplicar e Salvar
- Detalhes: Botão para abrir modal de edição individual

#### 2. Criação Inline de Tags/Subtags

**Funcionalidade**: Criar tags e subtags sem sair da página

**Processo**:
1. Seleciona "+ Criar Nova Tag" no dropdown
2. Digite o nome da tag
3. Automaticamente mostra "Outro" como subtag padrão
4. Pode criar nova subtag ou usar "Outro"
5. Tags/subtags são criadas ao salvar o grupo

**Regra de Negócio**: Toda tag criada recebe automaticamente duas subtags "Outro":
- Uma para tipo "receita"
- Uma para tipo "despesa"

#### 3. Aplicar em Massa

**Seção Destacada**: Área no topo da página para aplicação global

**Processo**:
1. Seleciona Tag/Subtag para Receitas (🟢)
2. Seleciona Tag/Subtag para Despesas (🔴)
3. Clica em "Aplicar Receitas" ou "Aplicar Despesas"
4. **Apenas os registros visíveis na página atual** recebem as tags
5. Se houver filtro de busca ativo, aplica apenas aos registros filtrados
6. Clica em "Salvar Todos" para persistir

**⚠️ Importante**: Os botões "Aplicar a Todos" aplicam apenas aos registros da página atual (respeitando paginação e filtros de busca). Para aplicar a todos os registros, navegue por todas as páginas ou remova os filtros.

**Mensagem de Sucesso**:
```
Tags aplicadas a 7 registro(s) da página atual

✅ 7 grupo(s) de receita atualizados

📌 Tag: Gu7
📌 Subtag: A1

💡 Próximo passo: Clique em "Salvar Todos" para persistir as mudanças.
```

#### 4. Botão "Aplicar a todos os registros"

**Funcionalidade**: Sincronizar tags do grupo com registros individuais (APENAS NO FRONTEND)

**Quando usar**:
- Após aplicar tags globalmente
- Após mudar tag/subtag de um grupo específico
- Quando grupo e registros têm tags diferentes

**Ícone**: 📋 Copy (verde)
**Localização**: Coluna "Ações", antes do botão Salvar
**Estado**: Desabilitado quando grupo e registros já estão sincronizados

**⚠️ IMPORTANTE**: Este botão **NÃO salva no banco de dados**! Ele apenas sincroniza os valores no estado local (frontend). Para persistir as mudanças, é necessário clicar em "Salvar" ou "Salvar Todos".

#### 5. Busca e Filtro de Registros

**Funcionalidade**: Buscar registros por descrição

**Localização**: Campo de busca acima da tabela de grupos

**Comportamento**:
- Filtra registros em tempo real pela descrição
- Mostra contador de registros filtrados
- Reseta para a primeira página ao buscar
- Detecta automaticamente se é **pattern** ou **regex**:
  - **Pattern**: Texto simples (ex: "uber")
  - **Regex**: Contém caracteres especiais (ex: "uber.*eats", "^pix.*[0-9]+$")

**Indicador de Modo**:
```
🔍 Buscar: [uber eats        ] 🔄 Modo: Pattern
🔍 Buscar: [^uber.*eats$     ] 🔄 Modo: Regex
```

#### 6. Virtual Grouping (Reagrupamento)

**Funcionalidade**: Combinar múltiplos grupos filtrados em um único grupo virtual para mapeamento em lote

**Quando usar**:
- Quando busca retorna múltiplos grupos com descrições similares
- Para criar um único mapeamento pattern/regex que capture todos os grupos
- Exemplo: Buscar "uber" retorna "uber *trip", "uber eats", "uber viagem" → Reagrupar todos

**Processo**:
1. Digite termo de busca (ex: "uber")
2. Sistema filtra e mostra grupos correspondentes
3. Clique em **"Reagrupar Todos"** (botão azul ao lado da busca)
4. Todos os grupos filtrados são combinados em um **Grupo Virtual**
5. Selecione tag/subtag para o grupo virtual
6. Marque checkbox **"Mapear"** para criar mapeamento pattern/regex
7. Clique em **"Salvar"** ou **"Salvar Todos"**

**Resultado**:
- Cria mapeamento pattern/regex com prioridade 10
- Atualiza todos os registros dos grupos filtrados com a subtag selecionada
- Usa **bulk update** para performance (1 requisição ao invés de N)

**Exemplo Visual**:
```
Antes do Reagrupamento:
┌─────────────────────────────────────────────────────────┐
│ Qtd │ Tipo │ Valor    │ Descrição          │ Tag │ ... │
├─────┼──────┼──────────┼────────────────────┼─────┼─────┤
│  15 │  🔴  │ R$ 450   │ uber *trip 1234    │ ... │     │
│   8 │  🔴  │ R$ 320   │ uber eats pedido   │ ... │     │
│   5 │  🔴  │ R$ 180   │ uber viagem        │ ... │     │
└─────────────────────────────────────────────────────────┘

Depois do Reagrupamento:
┌──────────────────────────────────────────────────────────────┐
│ 🔵 GRUPO VIRTUAL: "uber" (28 registros)                      │
├──────────────────────────────────────────────────────────────┤
│ Qtd │ Tipo │ Valor    │ Descrição │ Tag        │ Subtag │ ☑ │
├─────┼──────┼──────────┼───────────┼────────────┼────────┼───┤
│  28 │  🔴  │ R$ 950   │ uber      │ Transporte │ Uber   │ ✓ │
└──────────────────────────────────────────────────────────────┘
```

**Botões Disponíveis**:
- **Desfazer Reagrupamento**: Volta para visualização de grupos individuais
- **Limpar Seleções**: Limpa tag/subtag do grupo virtual
- **Salvar Todos**: Salva mapeamento + atualiza todos os registros

**Detecção Automática de Tipo**:
- Se busca contém caracteres especiais regex → cria `regex_pattern`
- Caso contrário → cria `pattern`

#### 7. Modal de Detalhes do Grupo

**Acesso**: Botão 📄 na coluna "Detalhes"

**Funcionalidades**:
- **Aplicar a Todos**: Dropdowns maiores (largura total) + botão verde à direita
- **Edição Individual**: Cada registro pode ter tag/subtag diferente
- **Criação Inline**: Criar tags/subtags dentro do modal
- **Agrupamento por Ano/Mês**: Registros organizados cronologicamente (mais recente primeiro)
- **Sincronização em Tempo Real**: Mudanças propagadas automaticamente para o estado pai
- **Suporte a ESC**: Pressionar ESC fecha o modal
- **Ordenação Completa**: Ano DESC → Mês DESC → Dia DESC

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│ Aplicar a Todos: [Tag ▼──────] [Subtag ▼──────]  [Aplicar] │
├─────────────────────────────────────────────────────────────┤
│ 📅 2024                                                      │
│   📆 Janeiro                                                 │
│     01/01 - NETFLIX - R$ 39,90  [Tag ▼] [Subtag ▼]         │
│     05/01 - SPOTIFY - R$ 19,90  [Tag ▼] [Subtag ▼]         │
├─────────────────────────────────────────────────────────────┤
│                                            [Fechar]          │
└─────────────────────────────────────────────────────────────┘
```

**Fluxo de Uso**:
1. Abrir modal de detalhes
2. Editar tags/subtags individuais ou aplicar globalmente
3. Fechar modal (mudanças já propagadas)
4. Clicar em "Salvar" do grupo na tela principal

#### 6. Controle de Mapeamentos

**Checkbox**: "Mapear futuras importações automaticamente"

- ✅ Marcado (padrão): Cria mapeamento em `transaction_mappings`
- ❌ Desmarcado: Apenas atualiza o registro atual

**Uso**:
- Marcar: Para descrições recorrentes (Netflix, Uber, etc.)
- Desmarcar: Para descrições únicas (compras pontuais)

**Validação Importante**:
- Se checkbox marcado: **TODOS** os registros do grupo devem ter a **MESMA** subtag
- Se registros têm subtags diferentes: Salvamento é bloqueado com erro
- Opções: Desmarcar checkbox OU aplicar mesma categoria a todos os registros

#### 7. Botão "Salvar Todos"

**Funcionalidade**: Salvar todos os grupos pendentes de uma vez

**Processo**:
1. Coleta todas as tags/subtags únicas **dos registros individuais** (não dos grupos)
2. Cria cada tag/subtag única no banco (evita duplicatas)
3. Cria subtags "Outro" automaticamente para cada tag criada
4. **Valida grupos com checkbox "Mapear" marcado**:
   - Se registros têm subtags diferentes → Grupo é **pulado**
   - Grupo inválido aparece na mensagem final
5. Atualiza **APENAS** os registros de grupos válidos em lote via `/bulk-update-subtags`
6. Cria mapeamentos para grupos válidos (se checkbox marcado) via `/mappings/bulk`

**⚠️ IMPORTANTE - Separação de Responsabilidades**:
- **`/bulk-update-subtags`**: Atualiza APENAS os registros enviados no array `records`
- **`/mappings/bulk`**: Cria APENAS mapeamentos na tabela `transaction_mappings`, NÃO atualiza registros existentes
- Registros de grupos inválidos permanecem com `subtag_id = null` no banco

**Otimização**:
- Usa Map para deduplicação
- Bulk update para performance
- Validação após criação de tags/subtags (usa IDs reais)

**Mensagem de Sucesso**:
```
Categorização Completa

53 registro(s) em 40 grupo(s) categorizados com sucesso!

✨ 39 mapeamento(s) criado(s)!
Futuras importações serão categorizadas automaticamente.

❌ 1 grupo(s) NÃO salvos (mapeamento inválido):

• "Shpstecnologia": Registros têm categorias diferentes: S1, S3, S4

Para salvar esses grupos:
1. Desmarque o checkbox "Mapear" para permitir categorias diferentes
2. Ou aplique a mesma categoria a todos os registros do grupo
```

### Componente
`CuradoriaPage.tsx` (2700+ linhas)

**Otimizações de Performance**:
- `useReducer` para gerenciar estado complexo
- `useMemo` para cálculos pesados
- `useCallback` para funções estáveis
- `React.memo` para TableRow com comparação customizada
- Processamento assíncrono de agrupamento

**Fluxo de Salvamento**:

**FASE 1**: Coletar tags/subtags únicas dos **REGISTROS** (não dos grupos)
**FASE 2**: Criar tags únicas no banco
**FASE 2.5**: Criar subtags para cada tag criada + subtags "Outro"
**FASE 3**: Mapear individualMappings pendentes para subtag_ids reais
**FASE 4**: Validar grupos com checkbox "Mapear" = TRUE
**FASE 5**: Bulk update de registros válidos
**FASE 6**: Criar mapeamentos para grupos válidos

**Regra Importante**: Tags/subtags são coletadas **APENAS** dos registros individuais, **NUNCA** dos grupos. Isso garante que apenas categorias realmente usadas sejam criadas.

## Página de Mapeamentos

Interface para gerenciar mapeamentos existentes.

### Funcionalidades

#### 1. Listagem de Mapeamentos

**Endpoint**: `GET /api/expenses/mappings`

**Exibição**:
- Descrição original
- Tag → Subtag
- Descrição mapeada (se houver)
- Data de criação
- Ações (Editar, Excluir)

#### 2. Criar Mapeamento

**Formulário**:
- Descrição original (obrigatório)
- Tag (obrigatório)
- Subtag (obrigatório)
- Descrição personalizada (opcional)
- Ícone (opcional)

**Endpoint**: `POST /api/expenses/mappings`

#### 3. Editar Mapeamento

**Permite alterar**:
- Tag/Subtag
- Descrição personalizada
- Ícone

**Endpoint**: `PUT /api/expenses/mappings/{id}`

#### 4. Excluir Mapeamento

**Soft delete**: Define `active = False`

**Endpoint**: `DELETE /api/expenses/mappings/{id}`

### Componente
`MapeamentosPage.tsx`

## Sistema de Ícones

Ícones personalizados para tags, subtags e mapeamentos usando **Lucide React**.

### Ícones Disponíveis

**Endpoint**: `GET /api/expenses/available-icons`

**Retorna**: Lista de ícones válidos do Lucide React (sem duplicatas)

**Categorias**:
- **Alimentação**: ShoppingCart, ShoppingBag, Coffee, Utensils, Pizza, Apple, etc.
- **Transporte**: Car, Bus, Train, Plane, Bike, Fuel, etc.
- **Moradia**: Home, Building, Lightbulb, Droplets, Wifi, etc.
- **Saúde**: Heart, Pill, Stethoscope, Brain, Dumbbell, etc.
- **Lazer**: PartyPopper, Gift, Cake, Popcorn, Trophy, etc.
- **Educação**: GraduationCap, School, Backpack, Pencil, Book, etc.
- **Vestuário**: Shirt, Watch, Glasses, Scissors, Umbrella, etc.
- **Finanças**: DollarSign, CreditCard, Wallet, PiggyBank, Calculator, etc.

### Nomes em Português

**Endpoint**: `GET /api/expenses/icon-names-pt`

**Retorna**: Mapeamento de nomes de ícones em inglês para português

**Exemplos**:
```json
{
  "ShoppingCart": "Carrinho",
  "Coffee": "Café",
  "Heart": "Coração",
  "Car": "Carro",
  "Home": "Casa",
  "Pizza": "Pizza"
}
```

**Armazenamento**: Configuração armazenada em `system_settings` com chave `icon_names_pt`

**Uso no Frontend**:
- Seletor de ícones mostra nomes em português
- Busca funciona em português e inglês
- Fallback para nome em inglês se tradução não existir

### Uso

**Em Tags**:
```python
tag = Tag(
    name="Alimentação",
    icon="ShoppingCart"  # Nome em inglês (Lucide React)
)
```

**Em Subtags**:
```python
subtag = Subtag(
    name="Supermercado",
    icon="ShoppingBag",  # Nome em inglês (Lucide React)
    type="despesa"
)
```

**Em Mapeamentos**:
```python
mapping = TransactionMapping(
    original_description="carrefour",
    subtag_id=5,
    icon="ShoppingBag"  # Sobrescreve ícone da subtag
)
```

### Validação de Ícones

**Ícones Inválidos**: Ícones que não existem no Lucide React são automaticamente removidos do migration 0002

**Fallback**: Se um ícone não for encontrado, o sistema usa `Tag` como fallback

**Manutenção**: Lista de ícones é mantida no migration 0002 e carregada em `system_settings`

## Endpoints da API

### Tags
- `GET /api/expenses/tags` - Lista todas as tags
- `POST /api/expenses/tags` - Cria nova tag
- `PUT /api/expenses/tags/{id}` - Atualiza tag
- `DELETE /api/expenses/tags/{id}` - Exclui tag (soft delete)

### Subtags
- `GET /api/expenses/subtags` - Lista todas as subtags
- `POST /api/expenses/subtags` - Cria nova subtag
- `PUT /api/expenses/subtags/{id}` - Atualiza subtag
- `DELETE /api/expenses/subtags/{id}` - Exclui subtag (soft delete)

### Mapeamentos
- `GET /api/expenses/mappings` - Lista todos os mapeamentos
- `POST /api/expenses/mappings` - Cria novo mapeamento (APENAS insere em transaction_mappings)
- `POST /api/expenses/mappings/bulk` - Cria múltiplos mapeamentos (APENAS insere em transaction_mappings)
- `PUT /api/expenses/mappings/{id}` - Atualiza mapeamento
- `DELETE /api/expenses/mappings/{id}` - Exclui mapeamento (soft delete)

### Curadoria
- `GET /api/expenses/unmapped-records` - Lista registros não mapeados (banco, cartão, benefícios)
- `PATCH /api/expenses/bulk-update-subtags` - Atualiza subtags em lote (suporta source: 'bank', 'card', 'benefit')
- `PATCH /api/expenses/bank-statements/{id}/subtag` - Atualiza subtag de extrato
- `PATCH /api/expenses/credit-card-invoices/{id}/subtag` - Atualiza subtag de fatura
- `PATCH /api/expenses/benefit-card-statements/{id}/subtag` - Atualiza subtag de benefício

