# Hospedagem online (Hetzner)

Deploy do Plumo em um **VPS único**, separado do dev/prod local. WhatsApp (Evolution) **não** entra nesta stack.

**Arquivos principais**

| Arquivo | Função |
|---------|--------|
| [`docker-compose.online.yml`](../docker-compose.online.yml) | Postgres 18 + auth + backend + web (Caddy) |
| [`env.online.example`](../env.online.example) | Template do `.env.online` (só no VPS) |
| [`deploy/Caddyfile`](../deploy/Caddyfile) | HTTPS, proxy `/api`, SPA estática |
| [`scripts/database/restore-online.sh`](../scripts/database/restore-online.sh) | Restore no container `plumo-online-postgres` |

Os compose locais (`docker-compose.db*.yml`, `docker-compose.evolution.yml`) **não são alterados** para o online.

---

## URL de acesso

| Item | Valor atual |
|------|-------------|
| IPv4 | `37.27.37.103` |
| Hostname sslip.io | `37-27-37-103.sslip.io` |
| **URL da família** | **https://37-27-37-103.sslip.io** |

Regra sslip.io: pontos do IP viram hífens no host (`A.B.C.D` → `A-B-C-D.sslip.io`).

Se o IPv4 mudar: atualize `PUBLIC_URL`, `PUBLIC_HOST`, `CORS_ORIGINS` em `.env.online`, rebuild da imagem `web` e (se preciso) `deploy/Caddyfile`.

**Documentação da API:** `/docs` e `/openapi.json` ficam **bloqueados** (404) na stack online — não há Swagger público.

---

## Visão da stack

```text
Internet → Caddy :443/:80 (container web)
            ├── /           → SPA (build Vite)
            ├── /api/*      → backend:8000
            ├── /uploads/*  → backend:8000
            └── /health     → backend:8000

backend:8000 ──HTTP──► auth:8001 (rede interna)
backend + auth ──► postgres:5432 (rede interna, volume plumo_online_pgdata)

Portas 8000/8001/5432 NÃO publicadas no host — só 80/443 no Caddy.
```

Projeto Compose: `gus-plumo-online` (containers `plumo-online-*`).

Comando padrão no VPS:

```bash
cd /opt/gus-plumo
docker compose --env-file .env.online -f docker-compose.online.yml <comando>
```

---

## Passo a passo completo

### Fase 0 — Criar o VPS (Hetzner)

1. Servidor Linux (ex.: **CPX12**, Helsinki, Ubuntu LTS).
2. **Firewall:** TCP **22**, **80**, **443** (SSH + web).
3. **SSH com chave** (sem login por senha no root).
4. Anotar o **IPv4** e montar o hostname sslip.io.

Conectar do Windows:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_plumo root@37.27.37.103
```

### Fase 1 — Preparar o servidor (uma vez)

No VPS:

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git python3 python3-pip

# Docker (script oficial)
curl -fsSL https://get.docker.com | sh

# Swap recomendado em 2 GB RAM (CPX12)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Fernet para gerar ENCRYPTION_KEY (alternativa: usar container backend depois)
pip3 install --break-system-packages cryptography 2>/dev/null || pip3 install cryptography
```

### Fase 2 — Clonar o repositório

Repositório **privado**: use **deploy key** no GitHub (chave só leitura no VPS em `~/.ssh/`, `Host github.com` no `~/.ssh/config`).

```bash
git clone git@github.com:SEU_USUARIO/gus-plumo.git /opt/gus-plumo
cd /opt/gus-plumo
```

### Fase 3 — Criar `.env.online`

#### 3.1 Copiar template

```bash
cd /opt/gus-plumo
cp env.online.example .env.online
chmod 600 .env.online
nano .env.online   # ou vim
```

#### 3.2 Gerar segredos (fase A — banco vazio)

Execute **no VPS** e cole os valores em `.env.online`:

| Variável | O que é | Como gerar (fase A) |
|----------|---------|---------------------|
| `DB_PASSWORD` | Senha do usuário Postgres `plumo` | `openssl rand -base64 24` |
| `JWT_SECRET_KEY` | Assinatura dos tokens JWT (auth + backend) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Chave **Fernet** para campos criptografados no backend | Ver abaixo |

**ENCRYPTION_KEY (Fernet)** — não use `openssl rand` aqui; precisa ser chave Fernet válida:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

No **Windows** (com venv do backend):

```powershell
cd c:\Workspace\gus-plumo\services\backend
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

#### 3.3 URL e flags

- `PUBLIC_URL`, `CORS_ORIGINS`: mesma origem HTTPS (`https://37-27-37-103.sslip.io`).
- `PUBLIC_HOST`: só hostname, sem `https://` (`37-27-37-103.sslip.io`).
- **`RUN_MIGRATIONS=1`** na primeira subida (fase A).

#### 3.4 Fase B — depois do restore de produção

**Substitua** no `.env.online`:

- `JWT_SECRET_KEY` e `ENCRYPTION_KEY` → **copie exatamente** de `.env.prod` local (mesmo backup de origem).
- `RUN_MIGRATIONS=0` → não reaplicar migrations após `pg_restore`.
- `DB_PASSWORD` pode permanecer a do VPS (só o cluster online); os **dados** vêm do restore.

Não commite `.env.online` nem backups (`.backup`/`.sql`) no Git.

#### 3.5 Checklist do `.env.online`

- [ ] `DB_PASSWORD`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY` preenchidos (não placeholders).
- [ ] `chmod 600 .env.online`
- [ ] `JWT_SECRET_KEY` idêntico em auth e backend (o Compose injeta os dois).
- [ ] Após restore: chaves iguais ao ambiente do backup.

O Compose **falha no build/up** se `DB_PASSWORD`, `JWT_SECRET_KEY` ou `ENCRYPTION_KEY` estiverem vazios (`:?` no `docker-compose.online.yml`).

---

### Fase 4 — Build e subir (fase A, smoke test)

```bash
cd /opt/gus-plumo
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build
docker compose --env-file .env.online -f docker-compose.online.yml ps
```

O **backend** roda migrations no start (`RUN_MIGRATIONS=1` → `deploy/backend-entrypoint.sh` → `migration_runner.py --apply-all`), incluindo seed da migration `0002`. **Não é necessário** rodar migration manualmente se o container backend subiu sem erro.

**Validar:**

```bash
curl -sS https://37-27-37-103.sslip.io/health
# → {"status":"healthy"}
```

Login seed (só fase A, **troque a senha antes de dados reais**):

- E-mail: `gustavoquinelato@gmail.com`
- Senha: `Gus@2026!` (definida na migration `0002`)

Logs se algo falhar:

```bash
docker compose --env-file .env.online -f docker-compose.online.yml logs backend --tail 80
docker compose --env-file .env.online -f docker-compose.online.yml logs postgres --tail 50
```

---

### Fase 5 — Segurança rápida (antes do restore)

```bash
# OpenAPI não deve vazar (esperado: 404)
curl -sS -o /dev/null -w "%{http_code}\n" https://37-27-37-103.sslip.io/openapi.json
curl -sS -o /dev/null -w "%{http_code}\n" https://37-27-37-103.sslip.io/docs

# API sem token → 401/403 (não 200)
curl -sS -o /dev/null -w "%{http_code}\n" https://37-27-37-103.sslip.io/api/loans

# Portas no host (não deve listar 5432/8000/8001)
ss -tlnp | grep -E ':(22|80|443|5432|8000|8001)\b'
```

Recomendações:

- Trocar senha do usuário seed após validar a fase A.
- Não publicar backups no Git.
- Após restore, login com credenciais do ambiente de origem.

---

### Fase 6 — Restore de produção (fase B)

#### 6.1 Gerar backup no PC (prod local)

Com Postgres local no Docker (`docker-compose.db.yml`), use os scripts em `scripts/database/` ou, se o container for `plumo-postgres`:

```powershell
cd c:\Workspace\gus-plumo
.\scripts\database\backup-database.bat
# Gera backups\plumo_prod_YYYYMMDD_HH-MM-SS.backup
```

#### 6.2 Parar apps no VPS (mantém Postgres)

```bash
cd /opt/gus-plumo
docker compose --env-file .env.online -f docker-compose.online.yml stop backend auth web
```

#### 6.3 Enviar backup

```powershell
scp -i $env:USERPROFILE\.ssh\id_ed25519_plumo `
  c:\Workspace\gus-plumo\backups\SEU_ARQUIVO.backup `
  root@37.27.37.103:/opt/gus-plumo/backups/
```

No VPS: `mkdir -p /opt/gus-plumo/backups`

#### 6.4 Restore

```bash
cd /opt/gus-plumo
chmod +x scripts/database/restore-online.sh
./scripts/database/restore-online.sh backups/SEU_ARQUIVO.backup
```

#### 6.5 Ajustar `.env.online` e subir

1. `JWT_SECRET_KEY` e `ENCRYPTION_KEY` = mesmos de `.env.prod`.
2. `RUN_MIGRATIONS=0`
3. `docker compose --env-file .env.online -f docker-compose.online.yml up -d`

**Avatares / uploads:** o restore **não** copia `services/backend/uploads/`. Se precisar, copie para o volume Docker `plumo_online_uploads` (arquivos sob `avatars/`) via `docker cp` ou rsync documentado no suporte.

---

### Fase 7 — Atualizar código no VPS

```bash
cd /opt/gus-plumo
git pull
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build
```

Só mudança de Caddy/frontend:

```bash
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build web
```

Só backend:

```bash
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build backend
```

---

## Infra já provisionada (referência)

- Hetzner CPX12, Helsinki, Ubuntu, nome `plumo`, IPv4 `37.27.37.103`
- Firewall 22/80/443
- Chave SSH `id_ed25519_plumo`
- Sem domínio próprio (sslip.io)
- ~US$ 11/mês; 2 GB RAM — swap de 2 GB ajuda em builds/importações

## Local vs online (Compose)

| Ambiente | Arquivo |
|----------|---------|
| Postgres dev (5433) | `docker-compose.db.dev.yml` |
| Postgres prod local (5432) | `docker-compose.db.yml` |
| WhatsApp local | `docker-compose.evolution.yml` |
| **Stack online** | **`docker-compose.online.yml`** |

Local: `.env.dev` / `.env.prod`. Online: **`.env.online`** apenas no servidor.

---

## Segurança (resumo)

| Item | Comportamento |
|------|----------------|
| Postgres / auth / backend | Sem `ports:` no host |
| Login | Frontend → backend `/api/auth/login` → auth interno |
| Rotas de negócio | JWT obrigatório (`require_account` / `get_current_user`) |
| Swagger | 404 no Caddy; FastAPI docs desligados com `ENVIRONMENT=online` |
| `/uploads` | Público por URL (avatares) — uso familiar; avalie endurecer se necessário |
| Rate limit login | Não há no app — senha forte + firewall SSH |

---

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| `plumo-online-postgres` unhealthy | Postgres **18** monta volume em `/var/lib/postgresql`, não em `.../data`. Sem dados de prod: `down` → `docker volume rm plumo_online_pgdata` → `up -d --build`. Logs: `logs postgres --tail 80` |
| Build `web` falha no `tsc` | Corrigir frontend local (`npm run build`); `git pull` no VPS |
| 502 / login | `logs backend auth` |
| CORS | `CORS_ORIGINS` = `PUBLIC_URL` exato (mesma origem HTTPS) |
| `ENCRYPTION_KEY inválida` | Use Fernet (`Fernet.generate_key()`), não hex aleatório |
| Restore falhou | Postgres up? `ps`; confirme `DB_USER`/`DB_NAME` no `.env.online` |
| OpenAPI retorna 200 | `git pull`, rebuild `web` + `backend`; espere 404 |

---

## Referências

- [ambientes.md](ambientes.md) — dev/prod local
- [arquitetura.md](arquitetura.md)
- [whatsapp-evolution.md](whatsapp-evolution.md) — apenas local por enquanto
- [security-auth.mdc](../.cursor/rules/security-auth.mdc) — regras de auth no código