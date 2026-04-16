# Sistema de Migrations - Gus Expenses Platform

## 📋 Visão Geral

Este diretório contém as migrations do banco de dados para a Plataforma Gus Despesas. As migrations são executadas em ordem numérica e permitem versionar o esquema do banco de dados.

## 🚀 Como Usar

### Verificar Status das Migrations

```bash
cd services/backend
python scripts/migration_runner.py --status
```

### Aplicar Todas as Migrations Pendentes

```bash
cd services/backend
python scripts/migration_runner.py --aplicar-todas
```

### Reverter para uma Migration Específica

```bash
cd services/backend
# Reverter para migration 0001
python scripts/migration_runner.py --reverter-ate 0001

# Reverter todas as migrations (reset completo)
python scripts/migration_runner.py --reverter-ate 0
```

## 📁 Estrutura das Migrations

Cada migration segue o padrão de nomenclatura: `XXXX_nome_descritivo.py`

- `XXXX`: Número sequencial de 4 dígitos (ex: 0001, 0002, 0003)
- `nome_descritivo`: Nome descritivo da migration em snake_case

### Exemplo de Migration

```python
#!/usr/bin/env python3
"""
Migration 0001: Tabelas Iniciais
Descrição: Cria as tabelas de categorias, subcategorias e mapeamento de despesas
"""

def aplicar(connection):
    """Aplica a migration."""
    cursor = connection.cursor()
    # Código para criar tabelas, inserir dados, etc.
    connection.commit()

def reverter(connection):
    """Reverte a migration."""
    cursor = connection.cursor()
    # Código para desfazer as mudanças
    connection.commit()
```

## 📊 Migrations Disponíveis

### 0001_tabelas_iniciais.py

**Descrição:** Cria as tabelas iniciais do sistema de despesas

**Tabelas criadas:**
- `categorias`: Categorias principais de despesas
- `sub_categorias`: Subcategorias dentro de cada categoria
- `mapeamento_despesas`: Mapeamento de despesas específicas para subcategorias

**Dados inseridos:**
- 17 categorias principais
- 70+ subcategorias
- 450+ mapeamentos de despesas

**Categorias incluídas:**
- Acalento
- Alimentação
- Assinaturas
- Carla
- Carro
- Cartão
- Compras Online
- Estudos
- Governo
- Lazer
- Moradia
- Multas & Juros
- Reembolsos
- Saque
- Saúde & Bem estar
- Trabalho
- Vestuário

## 🔧 Configuração

As migrations usam a variável de ambiente `DATABASE_URL` para conectar ao banco de dados.

**Formato da URL:**
```
postgresql://usuario:senha@host:porta/database
```

**Exemplo:**
```
DATABASE_URL=postgresql://postgres:expenses@localhost:5432/expenses_db
```

## ⚠️ Importante

1. **Sempre faça backup** do banco de dados antes de aplicar migrations em produção
2. **Teste as migrations** em ambiente de desenvolvimento primeiro
3. **Não edite migrations já aplicadas** - crie uma nova migration para fazer alterações
4. **Mantenha a ordem** - migrations devem ser aplicadas em sequência numérica

## 📝 Tabela de Histórico

O sistema mantém uma tabela `historico_migrations` que rastreia:
- Número da migration
- Nome da migration
- Data de aplicação
- Data de reversão (se aplicável)
- Status (aplicado/revertido)

## 🛠️ Desenvolvimento

Para criar uma nova migration, siga o padrão das migrations existentes:

1. Crie um arquivo com o próximo número sequencial
2. Implemente as funções `aplicar()` e `reverter()`
3. Teste a migration em ambiente de desenvolvimento
4. Documente as mudanças no README

## 📚 Referências

- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Psycopg2 Documentation](https://www.psycopg.org/docs/)

