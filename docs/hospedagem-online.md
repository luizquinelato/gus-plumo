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

Conectar do Windows (OpenSSH no terminal):

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_plumo root@37.27.37.103
```

#### PuTTY (opcional)

O PuTTY usa chave no formato **`.ppk`**. Use a **mesma** chave privada do PC (`%USERPROFILE%\.ssh\id_ed25519_plumo`) — **não** gere chave nova no PuTTYgen, senão o VPS recusa até você cadastrar a chave pública no Hetzner.

1. **PuTTYgen** → **Conversions → Import key** → selecione `id_ed25519_plumo`.
2. Confira o comentário (ex.: `plumo-hetzner`) e que o tipo é **ed25519** (ignorar “RSA 2048” na parte de baixo se você importou uma chave existente).
3. **Save private key** → ex.: `%USERPROFILE%\.ssh\putty-ssh-key.ppk` (passphrase opcional).

**PuTTY (sessão salva, ex. `Plumo online`):**

| Ajuste | Valor |
|--------|--------|
| **Session → Host Name** | Só o IPv4: `37.27.37.103` (sem `root@`, sem texto extra — host inválido tipo `37.27.37.103ousó…` gera *Host does not exist*) |
| **Session → Port** | `22` |
| **Connection → Data → Auto-login username** | `root` |
| **Connection → SSH → Auth → Credentials → Private key file** | Caminho do `.ppk` |
| **Session** | Nome da sessão → **Save** → **Open** |

Prompt **“login as:”** → `root`. Com chave correta **não** pede senha de root (o VPS usa autenticação por chave).

**Se pedir senha do root:** a chave não foi aceita — sessão sem **Save** após apontar o `.ppk`, `.ppk` de outra chave, ou chave pública ausente no servidor. Teste no PowerShell com o comando `ssh -i` acima; se o terminal entrar e o PuTTY não, reimporte `id_ed25519_plumo` no PuTTYgen e atualize o **Private key file**. **Window → Event log** no PuTTY: `Server refused our key` = chave não está em `authorized_keys` / Hetzner.

**WinSCP (arquivos / backups):** mesmo host, usuário `root`, porta `22`, protocolo SFTP, mesma chave `.ppk`.

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

#### 3.4 Backup / restore e chaves (sem sidecar, VPS só `.env.online`)

- **Backup:** `--from prod|dev` grava dump + arquivo `.meta` (só `SOURCE_ENV` — **pode** ir no Git com a pasta `backups/`).
- **Restore:** `--to` = destino do banco; `--keys` = ambiente de onde vieram os dados cifrados (normalmente = `SOURCE_ENV` do `.meta`).
- **No VPS** não há `.env.prod` — um único comando no PC publica chaves:

```powershell
.\scripts\database\ship-online-env.ps1 -Keys prod
```

Isso sincroniza a partir de `.env.prod` no PC, valida `.env.online` e faz `scp` (não envia `.env.prod`).

| Variável | Fase B |
|----------|--------|
| JWT / ENCRYPTION em `.env.online` | Iguais ao **prod** (via `ship-online-env.ps1` no PC) |
| `DB_PASSWORD` | **Só** a do VPS (nunca copiada de prod) |
| `RUN_MIGRATIONS` | `0` após restore |

Não commite `.env.prod`, `.env.dev`, `.env.online`. Cuidado: dumps `.backup` têm dados financeiros (repo privado).

#### 3.6 Checklist do `.env.online`

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
- Backups em repo **privado**; `.meta` não contém segredos, o dump sim.
- Após restore, login com credenciais do ambiente de origem.

---

### Fase 6 — Restore de produção (fase B)

#### 6.1 No PC: backup + Git + env

```powershell
cd c:\Workspace\gus-plumo
.\scripts\database\backup-database.bat --from prod --for-online
git add backups
git commit -m "backup prod"
git push
.\scripts\database\ship-online-env.ps1 -Keys prod
```

Gera `plumo_prod_….backup`, `.sql` e `.meta` (sem segredos).

#### 6.2 No VPS: parar apps (mantém Postgres)

```bash
cd /opt/gus-plumo
docker compose --env-file .env.online -f docker-compose.online.yml stop backend auth web
```

#### 6.3 Pull + restore

```bash
git pull
chmod +x scripts/database/restore-online.sh
# Com plumo-online-rc.sh no bashrc:
# plumo-restore backups/plumo_prod_SEU_ARQUIVO.backup
./scripts/database/restore-online.sh backups/plumo_prod_SEU_ARQUIVO.backup --to online --keys prod
```

O script usa `.env.online` (enviado pelo `ship-online-env.ps1`), valida chaves e define `RUN_MIGRATIONS=0`. `--keys` pode ser omitido se existir `.meta`.

Restore local (ex. prod → dev):

```powershell
.\scripts\database\restore-database.bat backups\arquivo.backup --to dev --keys prod
```

#### 6.4 Subir stack

```bash
docker compose --env-file .env.online -f docker-compose.online.yml up -d
```

**Avatares / uploads:** o restore **não** copia `services/backend/uploads/`. Se precisar, copie para o volume Docker `plumo_online_uploads` (arquivos sob `avatars/`) via `docker cp` ou rsync documentado no suporte.

---

### Fase 7 — Atualizar código no VPS

#### CLI bash (somente online)

Helpers versionados em [`scripts/vps/plumo-online-rc.sh`](../scripts/vps/plumo-online-rc.sh) — **fixos** em `docker-compose.online.yml` + `.env.online` (sem `prod`/`dev`).

Instalação — **`gus` em qualquer pasta, sem `source`** (primeira vez no VPS **ou** quando [`scripts/vps/gus`](../scripts/vps/gus) mudar no repositório):

```bash
cd /opt/gus-plumo && git pull
sudo install -m 755 /opt/gus-plumo/scripts/vps/gus /usr/local/bin/gus
gus --help
```

O binário em `/usr/local/bin/gus` só é um launcher: a cada execução ele faz `source` de `plumo-online-rc.sh` no repo. Mudanças **só** no `.sh` passam a valer após `git pull`, **sem** reinstalar o launcher.

Opcional (atalhos `rat-build` soltos no shell): `source .../plumo-online-rc.sh` no `~/.bashrc`.

Comando principal: **`gus`** (sem args ou `gus --help` lista tudo). Estilo do CLI do PC: `gus rat-build`, `gus dkup`, …

| Comando | Ação |
|---------|------|
| `gus` / `gus --help` | Ajuda |
| `gus cd` / `plumo` / `e` | `cd` para o repo |
| `gus rat` / `gus dkup` | `up -d` stack inteira |
| `gus rat-build` | `up -d --build` após `git pull` |
| `gus kill-all` | `stop backend auth web` |
| `gus dkdown` / `gus dkdown-v` | down / down **-v** (confirmação) |
| `gus dkstatus` / `gus dklogs` | `ps` / logs |
| `gus dbm` / `gus dbr` / `gus dbs` | migrations |
| `gus restore [backup]` | `restore-online.sh` |
| `gus backup` | dump Postgres online |
| `gus health` | `curl` `/health` + `ps` |
| `gus reset` / `gus reset-full` | perigosos — ver ajuda |

Atalhos **sem** `gus` (`rat-build`, `dkup`, …) continuam válidos.

**Cuidado:** não use `reset` / `reset-full` / `dkdown-v` com dados de produção restaurados; use `gus restore`.

#### Trazer backup do VPS para o PC

No VPS: `gus backup` ou `./scripts/database/backup-online.sh`. Baixe `backups/plumo_online_*` com WinSCP/pscp ou `pull-backup-from-online.ps1` no PC. Restore: `restore-database.bat ... --to prod --keys online` (antes: `sync-env-keys.py --from online --to prod` se necessário).

Fluxo habitual após código novo:

```bash
gus cd
git pull
gus rat-build
```

#### `git pull`: o que repetir sempre e o que não

| Ação | Quando |
|------|--------|
| `git pull` | Sempre que atualizar código no VPS |
| `gus rat-build` | Quando mudou app ou imagens Docker (frontend, backend, auth, `Dockerfile`, `docker-compose.online.yml`, Caddy, etc.) |
| `sudo install -m 755 …/scripts/vps/gus /usr/local/bin/gus` | **Só** na instalação inicial **ou** quando o arquivo **`scripts/vps/gus`** (launcher) mudou no Git |
| `git checkout -- scripts/vps/gus` | **Só** se o `pull` falhar por alteração **local** nesse arquivo (ver abaixo) |

**Regra prática:** na maioria dos deploys basta `git pull` + `gus rat-build`. Não rode `checkout` nem `install` por hábito.

| O que mudou no `git pull` | O que fazer no VPS |
|---------------------------|-------------------|
| Código app, `plumo-online-rc.sh`, compose, Caddy, etc. | `gus rat-build` (launcher não precisa de `install`) |
| Apenas `scripts/vps/gus` (launcher) | `git pull` + `sudo install …` **uma vez** |
| Conflito: “local changes would be overwritten” em `scripts/vps/gus` | Descartar cópia suja no repo e puxar de novo (não edite arquivos versionados no servidor) |

**Evitar conflitos no `git pull`:** não edite nem dê `chmod` em arquivos **dentro** de `/opt/gus-plumo` que o Git rastreia. O executável global fica em `/usr/local/bin/gus` (cópia via `install`), fora do working tree.

Se o `pull` bloquear só em `scripts/vps/gus`:

```bash
cd /opt/gus-plumo
git checkout -- scripts/vps/gus
git pull
# Se o commit novo alterou o launcher:
sudo install -m 755 /opt/gus-plumo/scripts/vps/gus /usr/local/bin/gus
gus rat-build
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
| `git pull`: local changes em `scripts/vps/gus` | Não alterar o arquivo no repo; `git checkout -- scripts/vps/gus`, `git pull`, `sudo install …` se o launcher mudou — ver [Fase 7](#git-pull-o-que-repetir-sempre-e-o-que-não) |
| PuTTY: *Host does not exist* | **Host Name** com IP duplicado ou texto a mais — use só `37.27.37.103` |
| PuTTY: `login as:` + senha do root | Chave `.ppk` não na sessão salva ou chave diferente da do VPS — ver [PuTTY (opcional)](#putty-opcional) |

---

## Referências

- [ambientes.md](ambientes.md) — dev/prod local
- [arquitetura.md](arquitetura.md)
- [whatsapp-evolution.md](whatsapp-evolution.md) — apenas local por enquanto
- [security-auth.mdc](../.cursor/rules/security-auth.mdc) — regras de auth no código