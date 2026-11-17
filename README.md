# Plumo - Finanças leves, vida plena

**Assuma a direção. Sinta a leveza.**

Plataforma de gerenciamento de finanças pessoais e compartilhadas: importa extratos e faturas, categoriza lançamentos, fecha períodos e projeta os próximos meses. Backend Python, frontend React e PostgreSQL.

## 🏗️ Arquitetura

- **Banco de Dados**: PostgreSQL 18 em Docker (um container por ambiente: prod e dev)
- **Backend**: Python FastAPI + SQLAlchemy (`services/backend`)
- **Auth**: serviço FastAPI separado (`services/auth`)
- **Frontend**: React + TypeScript + Vite + Tailwind CSS (`services/frontend`)

Detalhes em [docs/arquitetura.md](docs/arquitetura.md).

## 📁 Estrutura do Projeto

```
gus-plumo/
├── .cursor/rules/            # Regras do projeto (fonte de verdade para agentes)
├── docs/                     # Documentação técnica
├── scripts/                  # setup_envs.py, database/ (backup/restore), utilitários
├── services/
│   ├── auth/                 # Serviço de autenticação
│   ├── backend/              # API (app/, scripts/migrations/, requirements/)
│   └── frontend/             # SPA (src/pages, src/components, ...)
├── docker-compose.db.yml     # PostgreSQL PROD (porta 5432)
├── docker-compose.db.dev.yml # PostgreSQL DEV (porta 5433)
├── docker-compose.online.yml # Stack completo no VPS (ver docs/hospedagem-online.md)
├── env.online.example        # Template de variáveis para o deploy online
├── .env.prod / .env.dev      # Templates de ambiente
```

Mapa completo em `.cursor/rules/project-structure.mdc`.

## 🚀 Começando

### Pré-requisitos

- Docker e Docker Compose
- Node.js 18+
- Python 3.11+

### Início Rápido (Windows, recomendado)

1. Instale os helpers do PowerShell: copie o conteúdo de `docs/powershell-helpers/powershell-profile.txt` para o seu `$PROFILE`, recarregue (`. $PROFILE`) e rode `expenses-health`.
2. Instale as dependências: `dev-setup` (ou `python scripts/setup_envs.py`).
3. Suba o banco e os serviços de **dev**:

```powershell
dkup-dev            # PostgreSQL dev (5433)
db-migrate-dev      # Aplica as migrations
run-all-tabs-dev    # Auth + backend + frontend em abas
```

Para prod: `dkup`, `db-migrate`, `run-all-tabs-prod` (ou `run-all-tabs`). Lista completa em [docs/powershell-helpers/README.md](docs/powershell-helpers/README.md).

### Portas por ambiente

| Serviço | Prod | Dev |
|---------|------|-----|
| PostgreSQL | 5432 (`plumo`) | 5433 (`plumo_dev`) |
| Backend | 8000 | 8010 |
| Auth | 8001 | 8011 |
| Frontend | 5173 | 5174 |

Documentação da API (Swagger): `http://localhost:<porta-do-backend>/docs`.

### Configuração Manual

```bash
# Banco (dev)
docker-compose -f docker-compose.db.dev.yml up -d

# Dependências (venvs por serviço + npm install)
python scripts/setup_envs.py            # --backend, --auth, --frontend, --force

# Backend
cd services/backend && python dev_server.py

# Frontend
cd services/frontend && npm run dev
```

Os serviços leem as variáveis de `.env.dev` / `.env.prod` (porta, `DATABASE_URL`, `AUTH_SERVICE_URL`, `VITE_API_URL`, `VITE_PORT`, CORS). Ver [docs/ambientes.md](docs/ambientes.md).

### Backup e Restore

```powershell
.\scripts\database\backup-database.bat --dev     # ou --prod
.\scripts\database\list-backups.bat
.\scripts\database\restore-database.bat --dev
```

## 🗄️ Banco de Dados

- Schema multi-tenant criado pela migration `0001`; dados iniciais na `0002`; alterações seguintes em `0003…0025` (`services/backend/scripts/migrations/`).
- Regras de migration em `.cursor/rules/starting_point.mdc`.
- Não há réplica configurada: cada ambiente tem um único container PostgreSQL.

## 🛠️ Desenvolvimento

- Backend: `python dev_server.py` (auto-reload).
- Frontend: `npm run dev` (HMR do Vite).
- Verificação de tipos: `npm run type-check` (em `services/frontend`).

### Scripts do Frontend
- `npm run dev` - Servidor de desenvolvimento
- `npm run build` - `tsc -b && vite build`
- `npm run preview` - Visualizar build
- `npm run type-check` - `tsc --noEmit`
- `npm run lint` - ESLint

## 🎨 Recursos do Frontend

- Tailwind CSS, layout responsivo, tema claro/escuro com cores personalizáveis
- Ícones Lucide React e gráficos Recharts
- React Router (rotas em `src/App.tsx`)

## 📊 Funcionalidades

- **Importação** (`/importar`): extratos (Excel), faturas de cartão (PDF), benefícios, holerites/informes
- **Curadoria e mapeamentos**: categorização em lote por tags/subtags, com mapeamento automático
- **Cadastros**: cartões, contas, compartilhamentos, tags/subtags, cores
- **Fechamentos**: conta, compartilhado (balanço) e conciliação de faturas
- **Relatórios**: extrato, faturas, saldo parcelado, projeção mensal, grupo, saúde financeira
- **Empréstimos** e **templates de despesa**
- **Multi-tenant** com contas por tenant

Detalhes em [docs/README.md](docs/README.md).

## 🐛 Solução de Problemas

```bash
# Containers do banco
docker-compose -f docker-compose.db.dev.yml ps
docker-compose -f docker-compose.db.dev.yml logs postgres-dev
# (prod: docker-compose.db.yml, serviço postgres-prod)
```

No PowerShell: `check-ports` mostra o que está usando 5173/5174/8000/8010/5432/5433, e `kill-all` encerra os serviços.

## 📄 Licença

Projeto pessoal - Todos os direitos reservados

