# Plumo - Finanças leves, vida plena

**Assuma a direção. Sinta a leveza.**

Uma plataforma moderna de gerenciamento de despesas pessoais com replicação PostgreSQL, backend Python e frontend React.

## 🏗️ Arquitetura

- **Banco de Dados**: PostgreSQL 17 com replicação automática (Primário + Réplica)
- **Backend**: Python FastAPI
- **Frontend**: React + TypeScript + Vite + Tailwind CSS

## 📁 Estrutura do Projeto

```
gus-expenses-platform/
├── docker/
│   └── postgres/
│       ├── init-replication.sh      # Configuração de replicação do BD primário
│       └── setup-replica.sh         # Configuração do BD réplica
├── services/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   └── main.py             # Aplicação FastAPI
│   │   ├── requirements.txt
│   │   ├── dev_server.py
│   │   └── .env.example
│   └── frontend/
│       ├── src/
│       │   ├── components/
│       │   │   └── Sidebar.tsx
│       │   ├── pages/
│       │   │   └── HomePage.tsx
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── index.css
│       ├── package.json
│       ├── vite.config.ts
│       └── tailwind.config.js
└── docker-compose.db.yml           # Serviços de banco de dados
```

## 🚀 Começando

### Pré-requisitos

- Docker e Docker Compose
- Node.js 18+ (para frontend)
- Python 3.11+ (para backend)

### Início Rápido (Recomendado)

#### 1. Instalar Helpers do PowerShell (Windows)
```powershell
# Abra seu perfil do PowerShell
notepad $PROFILE

# Copie o conteúdo de: docs/powershell-helpers/powershell-profile.ps1
# Cole no $PROFILE e salve

# Recarregue o perfil
. $PROFILE

# Verifique a instalação
expenses-health
```

#### 2. Configurar Ambiente de Desenvolvimento
```powershell
# Instalar todas as dependências (Python + Frontend)
dev-setup

# Ou manualmente:
python scripts/install_requirements.py  # Dependências Python
cd services/frontend && npm install      # Dependências Frontend
```

#### 3. Iniciar Tudo
```powershell
dkup           # Iniciar banco de dados
run-all-tabs   # Iniciar backend + frontend em abas
```

### Configuração Manual

### 1. Iniciar o Banco de Dados

```bash
# Iniciar PostgreSQL
docker-compose -f docker-compose.db.yml up -d

# Verificar saúde do banco de dados
docker-compose -f docker-compose.db.yml ps
```

**Conexão do Banco de Dados:**
- Host: `localhost:5432`
- Database: `expenses_db`
- User: `postgres`
- Password: `expenses`

**Backup e Restore:**
```bash
# Criar backup do banco de dados
backup-database.bat

# Listar backups disponíveis
list-backups.bat

# Restaurar backup
restore-database.bat
```

### 2. Instalar Dependências

```bash
# Instalar dependências Python (cria venv na raiz)
python scripts/install_requirements.py

# Instalar dependências do frontend
cd services/frontend
npm install
```

### 3. Configurar Backend

```bash
cd services/backend

# Copiar arquivo de ambiente
cp .env.example .env

# Ativar ambiente virtual (da raiz)
# No Windows:
..\..\..\venv\Scripts\activate
# No Linux/Mac:
source ../../venv/bin/activate

# Executar servidor de desenvolvimento
python dev_server.py
```

Backend estará disponível em: `http://localhost:8000`

Documentação da API: `http://localhost:8000/docs`

### 4. Configurar Frontend

```bash
cd services/frontend

# Executar servidor de desenvolvimento
npm run dev
```

Frontend estará disponível em: `http://localhost:5173`

## 🗄️ Configuração do Banco de Dados

A plataforma usa PostgreSQL com replicação em streaming:

- **Banco de Dados Primário**: Gerencia todas as operações de escrita
- **Banco de Dados Réplica**: Réplica somente leitura para escalar operações de leitura

### Recursos de Replicação

- Replicação em streaming automática
- Slot de replicação física (`replica_slot`)
- Modo hot standby na réplica
- Arquivamento WAL para recuperação point-in-time

### Testando a Replicação

```bash
# Conectar ao primário
docker exec -it expenses-postgres-primary psql -U postgres -d expenses_db

# Verificar status da replicação
SELECT * FROM pg_stat_replication;

# Conectar à réplica
docker exec -it expenses-postgres-replica psql -U postgres -d expenses_db

# Verificar se a réplica está em modo de recuperação
SELECT pg_is_in_recovery();
```

## 🛠️ Desenvolvimento

### Desenvolvimento Backend

```bash
cd services/backend
python dev_server.py
```

O servidor recarregará automaticamente ao alterar o código.

### Desenvolvimento Frontend

```bash
cd services/frontend
npm run dev
```

Vite fornece hot module replacement (HMR) para atualizações instantâneas.

### Verificação de Tipos (Frontend)

```bash
cd services/frontend
npm run type-check
```

## 📦 Scripts Disponíveis

### Helpers do PowerShell (Recomendado para Windows)

Veja [docs/powershell-helpers/README.md](docs/powershell-helpers/README.md) para documentação completa.

**Comandos Rápidos:**
- `dkup` / `dkdown` - Iniciar/parar banco de dados
- `run-backend` - Iniciar servidor backend
- `run-frontend` - Iniciar servidor frontend
- `run-all-tabs` - Iniciar todos os serviços em abas
- `kill-all` - Parar todos os serviços
- `expenses-health` - Verificação de saúde do sistema
- `dev-setup` - Instalar todas as dependências

### Backend
- `python dev_server.py` - Iniciar servidor de desenvolvimento com auto-reload
- `python scripts/install_requirements.py` - Instalar dependências Python

### Frontend
- `npm run dev` - Iniciar servidor de desenvolvimento
- `npm run build` - Build para produção
- `npm run preview` - Visualizar build de produção
- `npm run type-check` - Executar verificação de tipos TypeScript
- `npm run lint` - Executar ESLint

## 🔧 Configuração

### Variáveis de Ambiente do Backend

Crie um arquivo `.env` em `services/backend/`:

```env
DATABASE_URL=postgresql://postgres:expenses@localhost:5432/expenses_db
DATABASE_REPLICA_URL=postgresql://postgres:expenses@localhost:5433/expenses_db
APP_NAME=Plumo
DEBUG=True
```

## 🎨 Recursos do Frontend

- **UI Moderna**: Construída com Tailwind CSS
- **Design Responsivo**: Layout amigável para mobile
- **Tema Escuro**: Sidebar escura profissional
- **Biblioteca de Ícones**: Ícones Lucide React
- **Roteamento**: React Router para navegação

## 📊 Funcionalidades

### Importação de Dados

- ✅ **Extratos Bancários**: Importação de arquivos Excel (.xlsx) com pipeline ETL
- ✅ **Faturas de Cartão**: Importação de PDFs com extração automática de dados
- ✅ **Mapeamento Automático**: Tags e subtags mapeadas automaticamente
- ✅ **Validação de Dados**: Limpeza e normalização automática

### Gerenciamento

- ✅ **Cartões de Crédito**: CRUD completo de cartões
- ✅ **Tags e Subtags**: Organização hierárquica de despesas
- ✅ **Multi-tenant**: Suporte a múltiplos usuários/tenants

Para mais detalhes sobre a implementação, veja a [documentação técnica](docs/README.md).

## 📝 Próximos Passos

1. ✅ Banco de dados com replicação - **CONCLUÍDO**
2. ✅ Estrutura do backend - **CONCLUÍDO**
3. ✅ Frontend com sidebar - **CONCLUÍDO**
4. ✅ Modelos de banco de dados e migrações - **CONCLUÍDO**
5. ✅ Pipeline ETL para importação de extratos - **CONCLUÍDO**
6. ✅ Importação de faturas de cartão - **CONCLUÍDO**
7. 🔲 Adicionar autenticação JWT
8. 🔲 Dashboard com análises e relatórios
9. 🔲 Filtros e buscas avançadas

## 🐛 Solução de Problemas

### Problemas de Conexão com o Banco de Dados

```bash
# Verificar se os containers estão rodando
docker-compose -f docker-compose.db.yml ps

# Visualizar logs
docker-compose -f docker-compose.db.yml logs postgres-primary
docker-compose -f docker-compose.db.yml logs postgres-replica
```

### Réplica Não Sincronizando

```bash
# Verificar atraso de replicação
docker exec -it expenses-postgres-primary psql -U postgres -d expenses_db -c "SELECT * FROM pg_stat_replication;"
```

## 📄 Licença

Projeto pessoal - Todos os direitos reservados

