# Ambientes de Desenvolvimento

O projeto suporta dois ambientes: **desenvolvimento (dev)** e **produção (prod)**.

## Arquivos de Configuração

| Arquivo | Descrição |
|---------|-----------|
| `.env.dev` | Configuração de desenvolvimento |
| `.env.prod` | Configuração de produção |
| `.env.online` | Deploy no VPS (template: `env.online.example`). Ver [hospedagem-online.md](hospedagem-online.md). **Não** altera dev/prod local. |

Os serviços (backend, auth, frontend) leem o arquivo do ambiente em uso; as portas e a `DATABASE_URL` vêm dele.

## Diferenças entre Ambientes

| Aspecto | Dev | Prod |
|---------|-----|------|
| Database | `plumo_dev` | `plumo` |
| Usuário do banco | `plumo` | `plumo` |
| Porta do banco | `5433` | `5432` |
| Container | `plumo-postgres-dev` | `plumo-postgres` |
| Volume | `plumo_postgres_data_dev` | `plumo_postgres_data` |
| Network | `plumo-network-dev` | `plumo-network` |
| Backend / Auth / Frontend | `8010` / `8011` / `5174` | `8000` / `8001` / `5173` |
| Log Level | DEBUG | INFO |
| Timezone | `America/Sao_Paulo` | `America/Sao_Paulo` |

## Docker Compose

Dois arquivos separados permitem rodar os dois ambientes ao mesmo tempo (imagem `postgres:18`, sem réplica):

| Arquivo | Ambiente | Porta | Serviço | Container |
|---------|----------|-------|---------|-----------|
| `docker-compose.db.dev.yml` | DEV | 5433 | `postgres-dev` | `plumo-postgres-dev` |
| `docker-compose.db.yml` | PROD | 5432 | `postgres-prod` | `plumo-postgres` |

### Iniciar e parar

```powershell
# Helpers do PowerShell
dkup-dev ; dkup ; dkup-all
dkdown-dev ; dkdown ; dkdown-all

# Ou diretamente com docker-compose
docker-compose -f docker-compose.db.dev.yml up -d
docker-compose -f docker-compose.db.yml up -d
docker-compose -f docker-compose.db.dev.yml down
```

## Scripts de Database

Em `scripts/database/`:

| Script | Descrição | Parâmetros |
|--------|-----------|------------|
| `backup-database.bat` | Cria backup do banco | `--dev`, `--prod` |
| `restore-database.bat` | Restaura um backup | `--dev`, `--prod` |
| `list-backups.bat` | Lista backups disponíveis | - |

Para aplicar migrations use `db-migrate-dev` / `db-migrate` (helpers do PowerShell).

## Backups

Os backups são salvos em `backups/` com o nome do ambiente. Exemplo de formato:

```
backups/
├── plumo_prod_<data>_<hora>.backup
└── plumo_dev_<data>_<hora>.backup
```

Confira os nomes reais com `list-backups.bat`.

### Restaurar Backup em Ambiente Diferente

O script `restore-database.bat` aceita `--dev` e `--prod` para escolher o ambiente de destino:

```powershell
# Restaurar em DEV (para testar com dados reais)
.\scripts\database\restore-database.bat --dev

# Restaurar em PROD (cuidado!)
.\scripts\database\restore-database.bat --prod
```

**Caso de uso comum**: copiar dados de produção para desenvolvimento:

```powershell
.\scripts\database\backup-database.bat --prod
dkup-dev
.\scripts\database\restore-database.bat --dev
```

Para copiar só cadastros de prod para dev, veja também `scripts/sync_cadastro_prod_dev.py`.

## Variáveis de Ambiente

`.env.dev` / `.env.prod` contêm (valores de dev | prod; segredos omitidos):

```env
ENVIRONMENT=dev|prod

# Database
DB_HOST=localhost
DB_PORT=5433|5432
DB_NAME=plumo_dev|plumo
DB_USER=plumo
DATABASE_URL=postgresql://...

# Docker
CONTAINER_NAME=plumo-postgres-dev|plumo-postgres
VOLUME_NAME=plumo_postgres_data_dev|plumo_postgres_data
NETWORK_NAME=plumo-network-dev|plumo-network

# Logging
LOG_LEVEL=DEBUG|INFO
SQL_ECHO=false

# Timezone
TZ=America/Sao_Paulo
PGTZ=America/Sao_Paulo

# Portas e URLs
PORT=8010|8000
AUTH_SERVICE_URL=http://localhost:8011|http://localhost:8001
VITE_API_URL=http://localhost:8010|http://localhost:8000
VITE_PORT=5174|5173

# Segurança: JWT_ALGORITHM, chave de criptografia (AES-256), CORS_ORIGINS
```

## Fluxo de Trabalho Recomendado

### Rodar ambos os ambientes simultaneamente

```powershell
dkup-all        # sobe prod e dev
docker ps       # confere os containers
dkdown-all      # derruba ambos
```

### Desenvolvimento com dados de produção

```powershell
.\scripts\database\backup-database.bat --prod
.\scripts\database\restore-database.bat --dev
run-all-tabs-dev    # app usa plumo_dev na porta 5433
```

### Backup de ambos os ambientes

```powershell
# Backup de prod
.\scripts\database\backup-database.bat --prod

# Backup de dev
.\scripts\database\backup-database.bat --dev
```

## Ambiente online (VPS)

Deploy separado: `docker-compose.online.yml` + `.env.online` no servidor (template `env.online.example`).

Passo a passo completo — criar VPS, gerar `JWT_SECRET_KEY` / `ENCRYPTION_KEY` (Fernet), fase A (migrations) e fase B (restore): **[hospedagem-online.md](hospedagem-online.md)**.

