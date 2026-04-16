# Ambientes de Desenvolvimento

O projeto suporta dois ambientes: **desenvolvimento (dev)** e **produção (prod)**.

## Arquivos de Configuração

| Arquivo | Descrição |
|---------|-----------|
| `.env` | Arquivo ativo (usado pelo Docker e aplicação) |
| `.env.dev` | Template para desenvolvimento |
| `.env.prod` | Template para produção |

## Diferenças entre Ambientes

| Aspecto | Dev | Prod |
|---------|-----|------|
| Database | `expenses_db_dev` | `expenses_db` |
| Porta | `5433` | `5432` |
| Container | `expenses-postgres-dev` | `expenses-postgres` |
| Volume | `expenses_postgres_data_dev` | `expenses_postgres_data` |
| Network | `expenses-network-dev` | `expenses-network` |
| Log Level | DEBUG | INFO |
| SQL Echo | true | false |

## Docker Compose

O projeto possui dois arquivos docker-compose separados para permitir rodar ambos os ambientes simultaneamente:

| Arquivo | Ambiente | Porta | Container |
|---------|----------|-------|-----------|
| `docker-compose.db.dev.yml` | DEV | 5433 | expenses-postgres-dev |
| `docker-compose.db.yml` | PROD | 5432 | expenses-postgres |

### Iniciar ambos os ambientes

```powershell
# Iniciar DEV
.\scripts\database\start-database.bat --dev

# Iniciar PROD
.\scripts\database\start-database.bat --prod

# Ou diretamente com docker-compose
docker-compose -f docker-compose.db.dev.yml up -d
docker-compose -f docker-compose.db.yml up -d
```

### Parar ambientes

```powershell
# Parar DEV
.\scripts\database\stop-database.bat --dev

# Parar PROD
.\scripts\database\stop-database.bat --prod

# Parar TODOS
.\scripts\database\stop-database.bat --all
```

## Trocar Ambiente Ativo (.env)

O arquivo `.env` define qual ambiente é usado por padrão pelos scripts e pela aplicação:

```powershell
# Ver ambiente atual
.\scripts\database\switch-env.bat

# Trocar para desenvolvimento
.\scripts\database\switch-env.bat dev

# Trocar para produção
.\scripts\database\switch-env.bat prod
```

## Scripts de Database

Todos os scripts de banco de dados estão em `scripts/database/` e suportam `--dev` e `--prod`:

| Script | Descrição | Parâmetros |
|--------|-----------|------------|
| `start-database.bat` | Inicia o container PostgreSQL | `--dev`, `--prod` |
| `stop-database.bat` | Para o container PostgreSQL | `--dev`, `--prod`, `--all` |
| `backup-database.bat` | Cria backup do banco | `--dev`, `--prod` |
| `restore-database.bat` | Restaura um backup | `--dev`, `--prod` |
| `list-backups.bat` | Lista backups disponíveis | - |
| `switch-env.bat` | Troca o .env ativo | `dev`, `prod` |

## Backups

Os backups são salvos em `backups/` com o nome do ambiente:

```
backups/
├── expenses_db_prod_2026-02-09_10-30-00.backup
├── expenses_db_prod_2026-02-09_10-30-00.sql
├── expenses_db_dev_dev_2026-02-08_15-00-00.backup
└── expenses_db_dev_dev_2026-02-08_15-00-00.sql
```

### Restaurar Backup em Ambiente Diferente

O script `restore-database.bat` suporta parâmetros `--dev` e `--prod` para restaurar em um ambiente específico, independente do ambiente atual:

```powershell
# Restaurar backup de PROD em DEV (para testar com dados reais)
.\scripts\database\restore-database.bat --dev

# Restaurar backup específico em DEV
.\scripts\database\restore-database.bat --dev backups\expenses_db_prod_2026-02-09_10-30-00.backup

# Restaurar em PROD (cuidado!)
.\scripts\database\restore-database.bat --prod

# Restaurar no ambiente atual (comportamento padrão)
.\scripts\database\restore-database.bat
```

**Caso de uso comum**: Copiar dados de produção para desenvolvimento:

```powershell
# 1. Fazer backup de prod
.\scripts\database\switch-env.bat prod
.\scripts\database\backup-database.bat

# 2. Restaurar em dev (sem trocar de ambiente!)
.\scripts\database\switch-env.bat dev
.\scripts\database\start-database.bat
.\scripts\database\restore-database.bat --dev backups\expenses_db_prod_2026-02-09_10-30-00.backup
```

## Variáveis de Ambiente

O arquivo `.env` contém:

```env
# Ambiente
ENVIRONMENT=dev|prod

# Database
DB_HOST=localhost
DB_PORT=5432|5433
DB_NAME=expenses_db|expenses_db_dev
DB_USER=postgres
DB_PASSWORD=expenses
DATABASE_URL=postgresql://...

# Docker
CONTAINER_NAME=expenses-postgres|expenses-postgres-dev
VOLUME_NAME=expenses_postgres_data|expenses_postgres_data_dev
NETWORK_NAME=expenses-network|expenses-network-dev

# Logging
LOG_LEVEL=INFO|DEBUG
SQL_ECHO=false|true

# Timezone
TZ=America/New_York
PGTZ=America/New_York
```

## Fluxo de Trabalho Recomendado

### Rodar ambos os ambientes simultaneamente

```powershell
# Iniciar ambos
.\scripts\database\start-database.bat --dev
.\scripts\database\start-database.bat --prod

# Verificar containers rodando
docker ps

# Parar ambos
.\scripts\database\stop-database.bat --all
```

### Desenvolvimento com dados de produção

```powershell
# 1. Fazer backup de prod
.\scripts\database\backup-database.bat --prod

# 2. Restaurar em dev
.\scripts\database\restore-database.bat --dev backups\expenses_db_prod_2026-02-09_10-30-00.backup

# 3. Desenvolver usando DEV
.\scripts\database\switch-env.bat dev
# A aplicação agora usa expenses_db_dev na porta 5433
```

### Backup de ambos os ambientes

```powershell
# Backup de prod
.\scripts\database\backup-database.bat --prod

# Backup de dev
.\scripts\database\backup-database.bat --dev
```

