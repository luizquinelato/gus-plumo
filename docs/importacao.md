# Importação de Dados

Sistema de importação de extratos bancários, faturas de cartão de crédito e extratos de cartões de benefícios.

## Performance

O sistema foi otimizado para importação em larga escala (~5800 registros):

- **Operações vetorizadas** com pandas (10-100x mais rápido que loops)
- **Cache em memória** de subtags, mapeamentos e configurações (99% redução em queries)
- **Bulk queries** para detecção de duplicatas (1 query vs. 5800)
- **Bulk insert/update** com SQLAlchemy (80-95% mais rápido)

**Resultado**: Importação de 5800 registros em **5-20 segundos** (vs. 2-7 minutos antes das otimizações).

## Modal de Importação Unificado

Interface única para importar todos os tipos de arquivos financeiros.

### Componente
`UnifiedImportModal.tsx`

### Tipos de Arquivo Suportados

#### 1. Extrato Bancário (XLSX)
- Upload de arquivo Excel (.xlsx)
- Processamento via pipeline ETL
- Mapeamento automático de categorias

#### 2. Fatura de Cartão (PDF)
- Upload de arquivo PDF
- Seleção de ano/mês da fatura
- Conversão PDF → TXT → Dados estruturados

#### 3. Cartão de Benefícios (CSV)
- Upload de arquivo CSV
- Seleção do cartão de benefícios
- Mapeamento automático de categorias

## Importação de Extratos Bancários

### Pipeline ETL

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Extract   │ -> │  Transform  │ -> │    Load     │
└─────────────┘    └─────────────┘    └─────────────┘
```

### 1. Extract (Extração)

**Classe**: `ExtratoExtractor`

**Entrada**: Arquivo Excel (.xlsx)

**Processo**:
- Lê arquivo Excel com pandas
- Remove linhas vazias
- Valida colunas obrigatórias: Data, Descrição, Valor

**Saída**: DataFrame pandas

### 2. Transform (Transformação)

**Classe**: `ExtratoTransformer`

**Processo**:
- Normaliza datas (formato brasileiro → ISO)
- Normaliza valores (R$ 1.234,56 → 1234.56)
- Limpa descrições (remove espaços extras)
- Mapeia categorias usando `MappingHelper`
- Busca `subtag_id` baseado em:
  1. Mapeamento em `transaction_mappings` (prioridade)
  2. Regras hardcoded do `MappingHelper`
  3. Fallback: `subtag_id = NULL` (vai para Curadoria)

**Saída**: DataFrame transformado

### 3. Load (Carga)

**Função**: `save_extrato_records()` (otimizada)

**Processo**:
- **Preparação vetorizada**: Parsing de datas e valores em lote
- **Cache de referências**: Carrega subtags e mapeamentos (3 queries totais)
- **Bulk query de duplicatas**: Verifica todos os registros existentes (1 query)
- **Processamento em lote**: Usa `bulk_insert_mappings()` e `bulk_update_mappings()`
- Retorna estatísticas:
  - `linhas_salvas`: Registros inseridos (novos)
  - `linhas_atualizadas`: Registros atualizados (duplicatas)
  - `linhas_nao_mapeadas`: Registros sem categoria

**Performance**: ~5-15 segundos para 5800 registros

**Saída**: Estatísticas de importação

### Endpoint

```
POST /api/import/extrato
Content-Type: multipart/form-data

Body:
- file: arquivo.xlsx
```

**Response**:
```json
{
  "success": true,
  "linhas_salvas": 45,
  "linhas_atualizadas": 3,
  "linhas_com_erro": 0,
  "linhas_nao_mapeadas": 12,
  "registros_nao_mapeados": [...]
}
```

## Importação de Faturas de Cartão

### Fluxo de Processamento

```
PDF -> TXT -> Regex -> Dados -> Mapeamento -> Banco
```

### 1. Upload e Conversão

**Endpoint**: `POST /api/import/fatura`

**Entrada**:
- `file`: PDF da fatura
- `year_month`: Ano/mês (formato: "2025-01")

**Processo**:
- Salva PDF temporariamente
- Converte PDF → TXT usando `pdftotext`
- Extrai dados com regex

### 2. Extração de Dados

**Padrões Regex**:
- Data: `\d{2}/\d{2}`
- Descrição: Texto entre data e valor
- Valor: `R?\$?\s*[\d.,]+`
- Parcelas: `\d+/\d+` (ex: "3/12")

**Dados Extraídos**:
- Data da transação
- Descrição
- Valor
- Parcelas (se houver)
- Cartão (últimos 4 dígitos)

### 3. Processamento de Datas

**Lógica Inteligente**:

```python
# Exemplo: Fatura 2025-01 (Janeiro)
# Transação: 28/12 (Dezembro anterior)

if dia_transacao > 20 and mes_fatura == 1:
    # Transação do ano anterior
    data_real = f"{ano_fatura - 1}-12-{dia_transacao}"
else:
    # Transação do mês da fatura
    data_real = f"{ano_fatura}-{mes_fatura:02d}-{dia_transacao}"
```

**Considera**:
- Transações do mês anterior (fechamento ~dia 20)
- Parcelas (mantém data original da compra)
- Virada de ano

### 4. Mapeamento de Categorias

**Ordem de Prioridade**:

1. **Mapeamento do Usuário** (`transaction_mappings`)
   - Busca por descrição exata (case-insensitive)
   - Criado pelo usuário na Curadoria

2. **Parser do PDF** (Tag/Subtag do arquivo)
   - Regras hardcoded no `MappingHelper`
   - Baseado em palavras-chave

3. **Fallback**
   - `subtag_id = NULL`
   - Aparece na Curadoria para categorização manual

### 5. Persistência

**Classe**: `FaturaService.salvar_faturas_do_dataframe()` (otimizada)

**Processo**:
- **Cache de cartões**: Carrega todos os cartões em memória (1 query)
- **Cache de mapeamentos**: Carrega todos os mapeamentos (1 query)
- **Cache de configurações**: Carrega configurações de ajuste dos cartões (1 query)
- **Cache de subtags**: Carrega todas as subtags (1 query)
- **Bulk query de duplicatas**: Verifica registros existentes com tratamento especial para parcelas (1 query)
- **Bulk insert/update**: Usa `bulk_insert_mappings()` e `bulk_update_mappings()`
- Retorna estatísticas

**Performance**: ~5-20 segundos para 5800 registros

**Response**:
```json
{
  "success": true,
  "linhas_salvas": 23,
  "linhas_atualizadas": 0,
  "cartoes_distintos": 1,
  "linhas_nao_mapeadas": 5,
  "registros_nao_mapeados": [...]
}
```

## Importação de Cartões de Benefícios

### Fluxo de Processamento

```
CSV -> Parse -> Mapeamento -> Banco
```

### 1. Upload e Seleção

**Endpoint**: `POST /api/benefit-card-statements/importar-csv`

**Entrada**:
- `file`: CSV do extrato de benefícios
- `credit_card_id`: ID do cartão de benefícios (query param)

**Formato CSV Esperado**:
```csv
Data,Movimentação,Meio de Pagamento,Valor
01/12/2024,RESTAURANTE ABC,Débito,R$ 45,00
05/12/2024,SUPERMERCADO XYZ,Débito,R$ 120,50
```

### 2. Processamento de Dados (otimizado)

**Processo**:
- **Conversão para DataFrame**: Carrega CSV inteiro em pandas
- **Parsing vetorizado de datas**: `pd.to_datetime()` em lote
- **Parsing vetorizado de valores**: Remove R$, espaços, pontos e vírgulas em lote
- **Cache de mapeamentos**: Carrega todos os mapeamentos (1 query)
- **Bulk query de duplicatas**: Verifica registros existentes (1 query)
- **Bulk insert**: Usa `bulk_insert_mappings()`
- Determina tipo baseado no sinal:
  - **Positivo** = Receita (crédito/estorno)
  - **Negativo** = Despesa (débito)

**Performance**: ~5-15 segundos para 5800 registros

### 3. Mapeamento de Categorias

**Função**: `find_subtag_by_mapping()`

**Ordem de Prioridade**:

1. **Mapeamento do Usuário** (`transaction_mappings`)
   - Busca por descrição (case-insensitive, LIKE)
   - Filtra por tipo (receita/despesa)
   - Criado pelo usuário na Curadoria

2. **Fallback**
   - `subtag_id = NULL`
   - Aparece na Curadoria para categorização manual

### 4. Detecção de Duplicatas

```python
duplicata = db.query(BenefitCardStatement).filter(
    BenefitCardStatement.credit_card_id == cartao_id,
    BenefitCardStatement.date == data,
    BenefitCardStatement.description == descricao,
    BenefitCardStatement.amount == valor,
    BenefitCardStatement.tenant_id == tenant_id
).first()
```

### 5. Persistência

**Tabela**: `benefit_card_statements`

**Campos**:
- `credit_card_id`: FK para cartão de benefícios
- `date`: Data da transação
- `description`: Descrição da movimentação
- `payment_method`: Meio de pagamento (Débito, Crédito, etc.)
- `amount`: Valor (positivo = receita, negativo = despesa)
- `subtag_id`: FK para Subtag (pode ser NULL)

**Response**:
```json
{
  "message": "Importação concluída com sucesso",
  "registros_importados": 15,
  "registros_duplicados": 2,
  "unmapped": 8,
  "unmapped_records": [...]
}
```

### 6. Link para Curadoria

Após importação com registros não mapeados, o modal exibe:
- Contador de registros não mapeados
- Link "Ir para Curadoria" para categorização

## Modal de Curadoria

Após importação, se houver registros não mapeados, um modal aparece automaticamente.

### Funcionalidades

- Lista registros não categorizados
- Permite categorização individual ou em lote
- Cria mapeamentos automáticos para futuras importações
- Opção de ir para página de Curadoria completa

### Componente
`UnmappedRecordsModal.tsx`

## Detecção de Duplicatas e Conflitos

O sistema detecta registros existentes e permite ao usuário decidir como resolver conflitos.

### Chaves de Identificação

#### Extratos Bancários
- **Chave**: `(date, category, transaction, description)`
- Pode retornar múltiplos registros (timestamps HH:mm sem segundos)

#### Faturas de Cartão
- **Chave exata**: `(year_month, credit_card_id, description, date, current_installment, total_installments)`
- **Chave base** (múltiplos matches): `(year_month, credit_card_id, description, date)`

#### Cartões de Benefícios
- **Chave**: `(credit_card_id, date, description, amount)`

### Detecção de Conflitos

Quando um registro existente é encontrado, o sistema verifica:

1. **Conflito de Tag/Subtag**: `existing_subtag_id != new_subtag_id`
2. **Conflito de Valor**: `abs(existing_amount - new_amount) >= 0.005` (tolerância de meio centavo)

### Múltiplos Matches

Quando a chave retorna **múltiplos registros** (ex: mesma descrição/data mas valores diferentes):

1. **Tenta match por valor**: Se algum registro tem o mesmo valor do arquivo, usa esse
2. **Seleção manual**: Se nenhum valor bate, apresenta lista para o usuário escolher qual atualizar

**Dados exibidos na seleção**:
- ID do registro
- Valor atual
- Parcelas (para faturas: `2/10`)
- Tag/Subtag atual

### Modal de Revisão de Conflitos

**Componente**: `ConflictReviewModal.tsx`

**Funcionalidades**:
- Exibe conflitos agrupados por tipo de registro
- **Controles independentes**: Botões Ignorar/Aceitar separados para Tag e Valor
- **Seleção de registro**: Quando há múltiplos matches, permite escolher qual atualizar
- Mostra valores originais vs. novos com formatação visual

**Interface de Resolução**:
```typescript
interface ConflictResolution {
  existing_id: number;
  record_type: 'bank_statement' | 'credit_card_invoice' | 'benefit_statement';
  accept_tag_change: boolean;
  accept_amount_change: boolean;
  new_subtag_id?: number | null;
  new_amount?: number | null;
  selected_from_multiple?: boolean;
}
```

### Endpoint de Resolução

```
POST /api/import/resolve-conflicts
Content-Type: application/json

Body:
{
  "resolutions": [
    {
      "existing_id": 123,
      "record_type": "bank_statement",
      "accept_tag_change": true,
      "accept_amount_change": false,
      "new_subtag_id": 45
    }
  ]
}
```

