# 📝 Guia de Uso do Sistema de Logging

## 🎯 Configuração Rápida

### 1. Importar o Logger

```python
from app.core.logging_config import get_logger

logger = get_logger(__name__)
```

### 2. Usar em Funções/Routers

```python
from app.core.logging_config import get_logger

logger = get_logger(__name__)

@router.post("/api/exemplo")
async def exemplo_endpoint():
    logger.info("📥 Recebendo requisição no endpoint /api/exemplo")
    
    try:
        # Seu código aqui
        resultado = processar_dados()
        logger.debug(f"Resultado processado: {resultado}")
        return {"success": True}
    except Exception as e:
        logger.error(f"❌ Erro ao processar: {e}")
        raise
```

### 3. Usar em Classes (com Mixin)

```python
from app.core.logging_config import LoggerMixin

class MeuService(LoggerMixin):
    def processar(self):
        self.logger.info("🚀 Iniciando processamento")
        self.logger.debug("Detalhes do processamento...")
        self.logger.warning("⚠️ Atenção: algo pode estar errado")
```

---

## 📊 Níveis de Log

### DEBUG (Mais Detalhado)
Use para informações de desenvolvimento/debug:
```python
logger.debug(f"🔍 Variável x = {x}, y = {y}")
logger.debug(f"Traceback: {traceback.format_exc()}")
```

### INFO (Informativo)
Use para eventos importantes do fluxo normal:
```python
logger.info("✅ Usuário autenticado com sucesso")
logger.info(f"📊 Processados {count} registros")
logger.info("🚀 Serviço iniciado")
```

### WARNING (Aviso)
Use para situações anormais mas não críticas:
```python
logger.warning("⚠️ Subtag não encontrada, usando padrão")
logger.warning(f"Cache expirado, recarregando...")
```

### ERROR (Erro)
Use para erros que precisam atenção:
```python
logger.error(f"❌ Falha ao conectar ao banco: {e}")
logger.error(f"Erro ao processar linha {idx}: {error}")
```

### CRITICAL (Crítico)
Use para erros que impedem o funcionamento:
```python
logger.critical("🔥 Banco de dados inacessível!")
logger.critical("Sistema não pode continuar")
```

---

## 🎨 Boas Práticas

### ✅ BOM

```python
# Mensagens claras e informativas
logger.info("✅ Importação concluída: 150 registros criados, 10 duplicados")

# Use emojis para facilitar leitura visual
logger.debug("🔍 Buscando subtag...")
logger.error("❌ Erro ao salvar")
logger.warning("⚠️ Atenção")

# Inclua contexto relevante
logger.error(f"Erro ao processar linha {idx}: {error}")

# Use níveis apropriados
logger.debug("Detalhes técnicos...")  # Só aparece em DEBUG
logger.info("Evento importante")      # Sempre aparece
```

### ❌ RUIM

```python
# Mensagens genéricas
logger.info("Processando...")

# Sem contexto
logger.error("Erro")

# Nível errado
logger.critical("Usuário clicou no botão")  # Não é crítico!

# Informação sensível
logger.info(f"Senha do usuário: {senha}")  # NUNCA!
```

---

## 🔧 Configuração do Nível de Log

Edite `services/backend/app/core/logging_config.py`:

```python
# Linha 17
LOG_LEVEL = logging.INFO  # Mude aqui!
```

**Opções:**
- `logging.DEBUG` - Mostra TUDO (desenvolvimento)
- `logging.INFO` - Mostra eventos importantes (produção) ⭐ PADRÃO
- `logging.WARNING` - Só avisos e erros
- `logging.ERROR` - Só erros
- `logging.CRITICAL` - Só erros críticos

---

## 📁 Arquivos de Log

### Localização
```
logs/
  └── gus-expenses-backend.log       # Log principal
  └── gus-expenses-backend.log.1     # Backup 1
  └── gus-expenses-backend.log.2     # Backup 2
  ...
  └── gus-expenses-backend.log.10    # Backup 10
```

### Rotação Automática
- **Tamanho máximo:** 50MB por arquivo
- **Backups:** 10 arquivos
- **Total:** ~500MB de logs
- **Nota:** Arquivo único compartilhado por todos os processos

---

## 🔍 Exemplos Práticos

### Importação de Dados
```python
logger.info(f"📥 Iniciando importação de {len(df)} registros")

for idx, row in df.iterrows():
    try:
        logger.debug(f"Processando linha {idx}: {row['Descrição']}")
        # ... processar ...
        logger.debug(f"✅ Linha {idx} processada com sucesso")
    except Exception as e:
        logger.error(f"❌ Erro na linha {idx}: {e}")
        logger.debug(f"Traceback: {traceback.format_exc()}")

logger.info(f"✅ Importação concluída: {created} criados, {errors} erros")
```

### Busca de Dados
```python
logger.debug(f"🔍 Buscando subtag: '{subtag_name}'")

subtag = db.query(Subtag).filter(...).first()

if subtag:
    logger.debug(f"✅ Subtag encontrada: ID {subtag.id}")
else:
    logger.warning(f"⚠️ Subtag '{subtag_name}' não encontrada")
```

### API Endpoints
```python
@router.post("/api/processar")
async def processar(data: dict):
    logger.info(f"📥 POST /api/processar - {len(data)} itens")
    
    try:
        resultado = processar_dados(data)
        logger.info(f"✅ Processamento concluído: {resultado}")
        return {"success": True, "data": resultado}
    except ValueError as e:
        logger.warning(f"⚠️ Dados inválidos: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ Erro inesperado: {e}")
        logger.debug(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Erro interno")
```

---

## 🚀 Migração de `print()` para `logger`

### Antes
```python
print(f"Processando {count} registros")
print(f"ERRO: {e}")
```

### Depois
```python
logger.info(f"Processando {count} registros")
logger.error(f"❌ Erro: {e}")
```

---

## 📌 Resumo

| Situação | Nível | Exemplo |
|----------|-------|---------|
| Detalhes técnicos | `DEBUG` | `logger.debug("Variável x = 10")` |
| Evento importante | `INFO` | `logger.info("✅ Importação concluída")` |
| Situação anormal | `WARNING` | `logger.warning("⚠️ Cache expirado")` |
| Erro recuperável | `ERROR` | `logger.error("❌ Falha ao salvar")` |
| Erro fatal | `CRITICAL` | `logger.critical("🔥 Sistema inoperante")` |

---

**Sistema de logging configurado e pronto para uso!** 🎉

