# 🚀 Arquitetura ETL - Extratos Bancários

## 📋 Visão Geral

Este módulo implementa um **pipeline ETL (Extract-Transform-Load)** para processamento de extratos bancários, seguindo o padrão de separação de responsabilidades e facilitando a integração futura com sistemas de mensageria como RabbitMQ.

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│ 1. EXTRACT (ExtratoExtractor)                              │
│    - Ler arquivos Excel (.xls/.xlsx)                       │
│    - Limpar formatos e mesclagens                          │
│    - Remover colunas vazias                                │
│    - Retornar: List[Dict] com dados BRUTOS                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. TRANSFORM (ExtratoTransformer)                          │
│    - Mapear descrições (badoo → Tomato)                    │
│    - Mapear tags e subtags                                 │
│    - Converter datas                                        │
│    - Calcular ano/mês                                       │
│    - Retornar: List[Dict] com dados TRANSFORMADOS          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. LOAD (ExtratoLoader)                                    │
│    - Criar registros BankStatement                         │
│    - Salvar no banco de dados                              │
│    - Retornar: estatísticas                                │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Componentes

### 1. **ExtratoExtractor** (Extract)
**Responsabilidade**: Extrair dados brutos de arquivos Excel.

**Entrada**: 
- Lista de caminhos de arquivos `.xls` ou `.xlsx`

**Saída**:
```python
[
    {
        "data_hora": datetime,
        "categoria": str,
        "transacao": str,
        "descricao": str,  # ORIGINAL (ainda não mapeada)
        "valor": float
    },
    ...
]
```

**Operações**:
- Converte `.xls` para `.xlsx` se necessário
- Remove formatação (fontes, cores, bordas)
- Remove colunas desnecessárias (A, E, F, H, I, J, M, N)
- Remove linhas inválidas (sem data ou sem valor)
- Remove cabeçalhos do banco (linhas 1-10)

---

### 2. **ExtratoTransformer** (Transform)
**Responsabilidade**: Aplicar todas as transformações nos dados brutos.

**Entrada**: 
- Lista de registros brutos do `ExtratoExtractor`

**Saída**:
```python
[
    {
        "ano": int,
        "mes": str,
        "data_hora": datetime,
        "categoria": str,
        "transacao": str,
        "descricao": str,  # ✅ JÁ MAPEADA (badoo → Tomato)
        "valor": float,
        "tag": str,
        "subtag": str,
        "subtag_id": int
    },
    ...
]
```

**Operações**:
- **Mapeia descrições**: `badoo` → `Tomato`, `onlyfans` → `Onion`
- **Mapeia tags**: Baseado em categoria, transação, descrição e valor
- **Mapeia subtags**: Baseado em descrição e tag
- **Converte datas**: Para objetos `datetime`
- **Calcula campos derivados**: Ano e mês

---

### 3. **ExtratoLoader** (Load)
**Responsabilidade**: Salvar dados transformados no banco de dados.

**Entrada**: 
- Lista de registros transformados do `ExtratoTransformer`
- Sessão do banco de dados (SQLAlchemy)

**Saída**:
```python
{
    "linhas_salvas": int,
    "linhas_com_erro": int
}
```

**Operações**:
- Cria objetos `BankStatement` (modelo SQLAlchemy)
- Salva no banco de dados PostgreSQL
- Faz commit das transações
- Retorna estatísticas de carga

---

### 4. **ExtratoETL** (Orquestrador)
**Responsabilidade**: Coordenar o pipeline completo Extract → Transform → Load.

**Entrada**:
- Lista de caminhos de arquivos
- Sessão do banco de dados (opcional)
- MappingHelper (opcional)

**Saída**:
```python
{
    "success": bool,
    "arquivos_processados": int,
    "registros_extraidos": int,
    "registros_transformados": int,
    "linhas_salvas": int,
    "linhas_com_erro": int,
    "dataframe": pd.DataFrame  # opcional
}
```

**Operações**:
- Inicializa os 3 componentes (Extractor, Transformer, Loader)
- Executa o pipeline completo
- Trata erros e exceções
- Retorna estatísticas consolidadas

---

## 🔧 Uso

### Exemplo Básico
```python
from app.etl import ExtratoETL
from app.utils.mapping_helper import MappingHelper
from app.database import get_db

# Conecta ao banco
db = next(get_db())
mapping_helper = MappingHelper(db_connection=db.connection())

# Inicializa ETL
etl = ExtratoETL(
    db_session=db,
    mapping_helper=mapping_helper,
    tenant_id=1
)

# Executa pipeline
result = etl.process(
    file_paths=["extrato_janeiro.xls", "extrato_fevereiro.xls"],
    return_dataframe=True
)

print(f"Linhas salvas: {result['linhas_salvas']}")
```

### Uso Individual dos Componentes
```python
# 1. Apenas Extract
from app.etl import ExtratoExtractor

extractor = ExtratoExtractor()
raw_data = extractor.extract_from_files(["extrato.xls"])

# 2. Extract + Transform
from app.etl import ExtratoTransformer

transformer = ExtratoTransformer(mapping_helper=mapping_helper)
transformed_data = transformer.transform(raw_data)

# 3. Extract + Transform + Load
from app.etl import ExtratoLoader

loader = ExtratoLoader(db_session=db, tenant_id=1)
stats = loader.load(transformed_data)
```

---

## 🎯 Benefícios

### 1. **Separação de Responsabilidades**
Cada componente tem uma única responsabilidade bem definida:
- **Extractor**: Apenas lê e limpa
- **Transformer**: Apenas transforma
- **Loader**: Apenas salva

### 2. **Testabilidade**
Cada componente pode ser testado independentemente:
```python
# Testa apenas o Extractor
def test_extractor():
    extractor = ExtratoExtractor()
    data = extractor.extract_from_files(["test.xls"])
    assert len(data) > 0
```

### 3. **Reutilizabilidade**
Os componentes podem ser reutilizados em diferentes contextos:
- API REST (FastAPI)
- Jobs agendados (Celery)
- Scripts de migração
- Testes automatizados

### 4. **Integração com RabbitMQ** 🐰
A arquitetura facilita a integração com sistemas de mensageria:

```python
# Produtor: Envia arquivo para fila
def send_to_queue(file_path):
    message = {"file_path": file_path, "tenant_id": 1}
    channel.basic_publish(exchange='', routing_key='extrato_queue', body=json.dumps(message))

# Consumidor: Processa arquivo da fila
def process_from_queue(ch, method, properties, body):
    message = json.loads(body)
    
    # Extract
    raw_data = ExtratoExtractor.extract_from_files([message["file_path"]])
    
    # Transform
    transformed_data = ExtratoTransformer().transform(raw_data)
    
    # Load
    ExtratoLoader(db, message["tenant_id"]).load(transformed_data)
```

---

## 📊 Fluxo de Dados

```
Arquivo Excel
    ↓
[EXTRACT] → Dados Brutos (List[Dict])
    ↓
[TRANSFORM] → Dados Transformados (List[Dict])
    ↓
[LOAD] → Banco de Dados (PostgreSQL)
```

---

## 🧪 Testes

Execute os testes do ETL:

```bash
# Testa apenas o Extractor
python scripts/test_etl.py extractor

# Testa Extractor + Transformer
python scripts/test_etl.py transformer

# Testa pipeline completo
python scripts/test_etl.py full
```

---

## 📝 Notas Importantes

1. **Descrições Mapeadas**: O mapeamento de descrições (ex: `badoo` → `Tomato`) acontece na etapa **TRANSFORM**, não no **EXTRACT**.

2. **Conexão com Banco**: O `ExtratoExtractor` **NÃO** precisa de conexão com banco. Apenas `ExtratoTransformer` (para MappingHelper) e `ExtratoLoader` precisam.

3. **Idempotência**: O pipeline é idempotente - executar múltiplas vezes com os mesmos dados não causa duplicação (desde que haja validação de duplicatas no banco).

4. **Tratamento de Erros**: Cada componente trata seus próprios erros e continua processando os registros válidos.

---

## 🔮 Próximos Passos

- [ ] Adicionar validação de schema (Pydantic)
- [ ] Implementar retry logic para falhas de banco
- [ ] Adicionar métricas e observabilidade
- [ ] Integrar com RabbitMQ para processamento assíncrono
- [ ] Adicionar suporte a outros formatos (CSV, JSON)

