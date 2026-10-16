# Helpers do PowerShell para Plataforma Gus Despesas

Este diretório contém utilitários PowerShell para otimizar o fluxo de trabalho de desenvolvimento da Plataforma Gus Despesas.

## 📁 Arquivos

- **`powershell-profile.txt`** - Funções PowerShell completas para copiar no seu `$PROFILE`

## 🚀 Configuração Rápida

### 1. Instalar Funções do PowerShell
```powershell
# Abra seu perfil do PowerShell
notepad $PROFILE

# Copie TODO o conteúdo de: docs/powershell-helpers/powershell-profile.txt
# Cole no seu $PROFILE e salve

# Recarregue seu perfil
. $PROFILE
```

### 2. Verificar Instalação
```powershell
expenses-health    # Deve mostrar o status do sistema
expenses           # Deve navegar para a raiz do projeto
```

---

## 🚀 Comandos Essenciais

| Comando | Descrição |
|---------|-----------|
| `expenses` | Ir para raiz do projeto |
| `run-all-tabs-dev` (`rat-dev`) | Iniciar auth + backend + frontend de dev em abas |
| `run-all-tabs-prod` (`rat`) | Idem para prod |
| `kill-all` | Parar todos os serviços |
| `expenses-health` | Verificação de saúde do sistema |
| `dkup-dev` / `dkup` | Iniciar banco dev / prod |
| `dkdown-dev` / `dkdown` | Parar banco dev / prod |
| `db-migrate-dev` / `db-migrate` | Aplicar migrations dev / prod |
| `db-status-dev` / `db-status` | Status das migrations |

## 📁 Navegação

| Comando | Diretório |
|---------|-----------|
| `expenses` (alias: `e`) | Raiz do projeto |
| `expenses-backend` (alias: `eb`) | Serviço backend |
| `expenses-frontend` (alias: `ef`) | Serviço frontend |
| `expenses-auth` | Serviço de autenticação |
| `expenses-docs` | Documentação |

## 🖥️ Serviços

Cada comando tem versão prod (sem sufixo) e dev (`-dev`).

| Prod | Dev | Serviço | Porta prod / dev |
|------|-----|---------|------------------|
| `run-backend` | `run-backend-dev` | API Backend | 8000 / 8010 |
| `run-auth` | `run-auth-dev` | Auth | 8001 / 8011 |
| `run-frontend` | `run-frontend-dev` | Frontend | 5173 / 5174 |
| `run-all-tabs-prod` | `run-all-tabs-dev` | Todos (abas) | - |

`run-all-tabs` também está disponível.

## 🗄️ Banco de Dados

### Docker

Não há réplica: um container PostgreSQL por ambiente.

| Prod | Dev | Todos | Ação |
|------|-----|-------|------|
| `dkup` | `dkup-dev` | `dkup-all` | Iniciar PostgreSQL |
| `dkdown` | `dkdown-dev` | `dkdown-all` | Parar PostgreSQL |
| `dklogs` | `dklogs-dev` | - | Logs |
| `dkstatus` | `dkstatus-dev` | `dkstatus-all` | Status |

**Portas do Banco de Dados:**
- Prod: `localhost:5432` (`plumo`)
- Dev: `localhost:5433` (`plumo_dev`)

### Migrations

| Prod | Dev | Todos | Ação |
|------|-----|-------|------|
| `db-migrate` | `db-migrate-dev` | `db-migrate-all` | Aplicar migrations pendentes |
| `db-status` | `db-status-dev` | `db-status-all` | Status das migrations |
| `db-rollback` | `db-rollback-dev` | `db-rollback-all` | Reverter todas |
| `db-rollback-to <numero>` | `db-rollback-to-dev <numero>` | - | Reverter até uma migration |

Aliases: `dbm`/`dbr`/`dbs` (prod), `dbm-dev`/`dbr-dev`/`dbs-dev` (dev), `dbm-all`/`dbr-all`/`dbs-all` (todos).

**Exemplos:**
```powershell
# Verificar status das migrations
db-status

# Aplicar todas as migrations pendentes
db-migrate

# Reverter todas as migrations
db-rollback

# Reverter até migration 0001
db-rollback-to 0001
```

## 🔧 Utilitários

| Comando | Propósito |
|---------|-----------|
| `check-ports` | Verificar uso de portas (confira a lista no perfil) |
| `code-expenses` | Abrir no VS Code |
| `git-status-all` | Status do Git |
| `dev-setup` | Configurar ambiente (instalar todas as deps) |
| `install-deps` | Instalar dependências Python |
| `install-frontend-deps` | Instalar dependências frontend |

---

## 🔧 Solução de Problemas

### Problemas com Perfil do PowerShell
```powershell
# Se você receber erros de sintaxe ao carregar o perfil:
# 1. Verifique a codificação do arquivo (deve ser UTF-8)
# 2. Remova caracteres emoji se causarem problemas
# 3. Use a versão limpa: powershell-profile.txt

# Teste a sintaxe do perfil antes de carregar:
Get-Content $PROFILE | Out-String | Invoke-Expression
```

### Problemas Comuns de Fluxo de Trabalho
```powershell
# Backend não inicia:
expenses-backend
.\.venv\Scripts\Activate.ps1
python dev_server.py

# Verificar o que está usando as portas:
check-ports

# Serviços não iniciam:
kill-all              # Pare tudo primeiro
run-all-tabs-dev      # Inicie novamente
```

---

## 📚 Exemplos de Fluxo de Trabalho Diário

### Início da Manhã
```powershell
expenses-health      # Verificar status do sistema
dkup-dev             # Iniciar banco de dev
db-status-dev        # Verificar status das migrations
run-all-tabs-dev     # Iniciar auth + backend + frontend
```

### Ciclo de Desenvolvimento
```powershell
# Fazer alterações no backend
# Backend recarrega automaticamente com uvicorn --reload

# Fazer alterações no frontend
# Frontend recarrega automaticamente com Vite HMR

# Verificar status
check-ports      # Verificar serviços em execução
```

### Trabalhando com Migrations
```powershell
# Verificar status das migrations
db-status-dev

# Aplicar novas migrations
db-migrate-dev

# Reverter para uma migration específica (desenvolvimento)
db-rollback-to-dev 0001

# Reset completo do banco (desenvolvimento)
db-rollback-dev
db-migrate-dev
```

### Fim do Dia
```powershell
kill-all         # Parar todos os serviços de forma limpa
dkdown-all       # Parar bancos de dados
```

---

## 🎯 Aliases Rápidos

- `e`, `eb`, `ef`, `ea` = `expenses`, `expenses-backend`, `expenses-frontend`, `expenses-auth`
- `rat` = `run-all-tabs-prod`, `rat-dev` = `run-all-tabs-dev`, `rat-all` = `run-all-tabs`
- `dbm` / `dbr` / `dbs` = `db-migrate` / `db-rollback` / `db-status` (sufixos `-dev` e `-all` também existem)

---

*Plumo - Finanças leves, vida plena*

