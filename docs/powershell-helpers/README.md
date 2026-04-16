# Helpers do PowerShell para Plataforma Gus Despesas

Este diretório contém utilitários PowerShell para otimizar o fluxo de trabalho de desenvolvimento da Plataforma Gus Despesas.

## 📁 Arquivos

- **`powershell-profile.ps1`** - Funções PowerShell completas para copiar no seu `$PROFILE`

## 🚀 Configuração Rápida

### 1. Instalar Funções do PowerShell
```powershell
# Abra seu perfil do PowerShell
notepad $PROFILE

# Copie TODO o conteúdo de: docs/powershell-helpers/powershell-profile.ps1
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
| `run-all-tabs` | Iniciar backend + frontend em abas |
| `kill-all` | Parar todos os serviços |
| `expenses-health` | Verificação de saúde do sistema |
| `dkup` | Iniciar serviços de banco de dados |
| `dkdown` | Parar serviços de banco de dados |
| `db-migrate` | Aplicar migrations do banco de dados |
| `db-status` | Verificar status das migrations |

## 📁 Navegação

| Comando | Diretório |
|---------|-----------|
| `expenses` (alias: `e`) | Raiz do projeto |
| `expenses-backend` (alias: `eb`) | Serviço backend |
| `expenses-frontend` (alias: `ef`) | Serviço frontend |
| `expenses-docs` | Documentação |

## 🖥️ Serviços

| Comando | Serviço | Porta |
|---------|---------|-------|
| `run-backend` | API Backend | 8000 |
| `run-frontend` | App Frontend | 5173 |
| `run-all` | Ambos (novas janelas) | - |
| `run-all-tabs` (alias: `rat`) | Ambos (abas) | - |

## 🗄️ Banco de Dados

### Docker

| Comando | Ação |
|---------|------|
| `dkup` | Iniciar PostgreSQL (Primário + Réplica) |
| `dkdown` | Parar serviços PostgreSQL |
| `dklogs` | Visualizar logs do banco de dados |
| `dkstatus` | Verificar status do banco de dados |

**Portas do Banco de Dados:**
- Primário: `localhost:5432`
- Réplica: `localhost:5433`

### Migrations

| Comando | Alias | Ação |
|---------|-------|------|
| `db-migrate` | `dbm` | Aplicar todas as migrations pendentes |
| `db-rollback` | `dbr` | Reverter todas as migrations |
| `db-status` | `dbs` | Verificar status das migrations |
| `db-rollback-to <numero>` | - | Reverter até migration específica |

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
| `check-ports` | Verificar uso de portas (5173, 8000, 5432, 5433) |
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
# 3. Use a versão limpa: powershell-profile.ps1

# Teste a sintaxe do perfil antes de carregar:
Get-Content $PROFILE | Out-String | Invoke-Expression
```

### Problemas Comuns de Fluxo de Trabalho
```powershell
# Backend não inicia:
expenses-backend
.\venv\Scripts\Activate.ps1
python dev_server.py

# Verificar o que está usando as portas:
check-ports       # Mostra todas as portas do Gus Expenses

# Serviços não iniciam:
kill-all          # Pare tudo primeiro
run-all-tabs      # Inicie novamente
```

---

## 📚 Exemplos de Fluxo de Trabalho Diário

### Início da Manhã
```powershell
expenses-health      # Verificar status do sistema
dkup                 # Iniciar banco de dados
db-status            # Verificar status das migrations
run-all-tabs         # Iniciar backend + frontend
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
db-status

# Aplicar novas migrations
db-migrate

# Reverter para uma migration específica (desenvolvimento)
db-rollback-to 0001

# Reset completo do banco (desenvolvimento)
db-rollback
db-migrate
```

### Fim do Dia
```powershell
kill-all         # Parar todos os serviços de forma limpa
dkdown           # Parar banco de dados
```

---

## 🎯 Aliases Rápidos

- **`e`** = `expenses` (ir para raiz do projeto)
- **`eb`** = `expenses-backend` (ir para backend)
- **`ef`** = `expenses-frontend` (ir para frontend)
- **`rat`** = `run-all-tabs` (iniciar todos os serviços em abas)
- **`dbm`** = `db-migrate` (aplicar migrations)
- **`dbr`** = `db-rollback` (reverter migrations)
- **`dbs`** = `db-status` (status das migrations)

---

## 📋 Referência Completa de Comandos

### Navegação
- `expenses` / `e` - Raiz do projeto
- `expenses-backend` / `eb` - Diretório backend
- `expenses-frontend` / `ef` - Diretório frontend
- `expenses-docs` - Diretório de documentação

### Docker/Banco de Dados
- `dkup` - Iniciar serviços de banco de dados
- `dkdown` - Parar serviços de banco de dados
- `dklogs` - Visualizar logs do banco de dados
- `dkstatus` - Verificar status do banco de dados

### Migrations
- `db-migrate` / `dbm` - Aplicar todas as migrations pendentes
- `db-rollback` / `dbr` - Reverter todas as migrations
- `db-status` / `dbs` - Verificar status das migrations
- `db-rollback-to <numero>` - Reverter até migration específica

### Serviços
- `run-backend` - Iniciar backend (porta 8000)
- `run-frontend` - Iniciar frontend (porta 5173)
- `run-all` - Iniciar todos (novas janelas)
- `run-all-tabs` / `rat` - Iniciar todos (abas)

### Desenvolvimento
- `kill-all` - Parar todos os processos
- `check-ports` - Verificar uso de portas
- `dev-setup` - Configuração completa do ambiente
- `install-deps` - Instalar deps Python
- `install-frontend-deps` - Instalar deps frontend
- `expenses-health` - Verificação de saúde do sistema
- `code-expenses` - Abrir no VS Code
- `git-status-all` - Status do Git

---

*Plumo - Finanças leves, vida plena | 2025*

