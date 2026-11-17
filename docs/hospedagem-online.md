# Hospedagem online (Hetzner)

Deploy do Plumo em um VPS único, separado do ambiente local (dev/prod em máquina). O WhatsApp (Evolution) **não** entra neste deploy.

## URL de acesso

| Item | Valor |
|------|--------|
| IPv4 | `37.27.37.103` |
| Hostname (sslip.io) | `37-27-37-103.sslip.io` |
| **URL para a família** | **https://37-27-37-103.sslip.io** |
| Swagger (pós-deploy) | https://37-27-37-103.sslip.io/docs |

Variáveis alinhadas a essa origem (ver [`env.online.example`](../env.online.example)):

- `PUBLIC_URL` / `VITE_API_URL` = `https://37-27-37-103.sslip.io`
- `CORS_ORIGINS` = mesma URL
- `PUBLIC_HOST` = `37-27-37-103.sslip.io` (TLS no Caddy)

Se o IPv4 mudar, troque hífens no sslip.io, atualize `.env.online`, `deploy/Caddyfile` (ou `PUBLIC_HOST`) e **rebuild** da imagem `web`.

## Local vs online (Compose)

Os compose locais **não são alterados**:

| Ambiente | Arquivo |
|----------|---------|
| Postgres dev (5433) | `docker-compose.db.dev.yml` |
| Postgres prod local (5432) | `docker-compose.db.yml` |
| WhatsApp local | `docker-compose.evolution.yml` |
| **Stack online (VPS)** | **`docker-compose.online.yml`** |

Local: `.env.dev` / `.env.prod`, `dkup-dev`, `run-all-tabs-dev`.

Online: `.env.online` (só no servidor), por exemplo:

```bash
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build
```

Projeto Compose: `gus-plumo-online` — containers não conflitam com `plumo-postgres-dev`.

## Infra provisionada (fase 0)

- **Provedor:** Hetzner Cloud, crédito inicial US$ 25 (pré-pago)
- **Servidor:** CPX12, Helsinki, Ubuntu 26.04, nome `plumo`
- **Firewall:** TCP 22, 80, 443
- **SSH:** chave `~/.ssh/id_ed25519_plumo` (comentário `plumo-hetzner`)
- Sem volumes Hetzner extras, sem backup gerenciado Hetzner
- Domínio próprio: opcional; usamos sslip.io

Conectar:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_plumo root@37.27.37.103
```

## Stack no VPS

```text
Browser → Caddy (443) → SPA estática
                      → /api, /uploads, /health, /docs → backend:8000
                      backend → auth:8001 (rede interna)
                      backend + auth → postgres (rede interna)
```

## Preparar o servidor (uma vez)

No VPS (Ubuntu), como `root` ou com sudo:

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git
# Docker oficial
curl -fsSL https://get.docker.com | sh

# Swap recomendado no CPX12 (2 GB RAM)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Clone o repositório (ex.: `/opt/gus-plumo`):

```bash
git clone <URL_DO_GITHUB> /opt/gus-plumo
cd /opt/gus-plumo
cp env.online.example .env.online
# Editar segredos (openssl rand -hex 32 para JWT e ENCRYPTION_KEY)
nano .env.online
```

Na **fase B** (restore de prod), copie de `.env.prod` local os mesmos `JWT_SECRET_KEY` e `ENCRYPTION_KEY` que o backup espera.

## Deploy — fase A (smoke test, banco vazio)

1. `RUN_MIGRATIONS=1` em `.env.online` (padrão no example).
2. Subir stack:

```bash
cd /opt/gus-plumo
docker compose --env-file .env.online -f docker-compose.online.yml up -d --build
```

3. Migrations rodam no start do backend (`migration_runner.py --apply-all`), incluindo seed da `0002`.
4. Validar:
   - https://37-27-37-103.sslip.io/health (via browser ou curl)
   - Login seed: e-mail `gustavoquinelato@gmail.com`, senha `Gus@2026!` (ver migration `0002`; auth usa SHA256).

## Deploy — fase B (dados de produção)

**Depois** de validar a fase A:

1. Parar apps que seguram conexões (mantém Postgres):

```bash
docker compose --env-file .env.online -f docker-compose.online.yml stop backend auth web
```

2. Enviar backup do PC:

```powershell
scp -i $env:USERPROFILE\.ssh\id_ed25519_plumo `
  c:\Workspace\gus-plumo\backups\plumo_prod_2026-11-16_17-26-03.backup `
  root@37.27.37.103:/opt/gus-plumo/backups/
```

3. No VPS, restore:

```bash
cd /opt/gus-plumo
chmod +x scripts/database/restore-online.sh
./scripts/database/restore-online.sh backups/plumo_prod_2026-11-16_17-26-03.backup
```

4. Em `.env.online`: `RUN_MIGRATIONS=0` (não reaplicar migrations após restore completo).
5. Subir de novo:

```bash
docker compose --env-file .env.online -f docker-compose.online.yml up -d
```

6. Login com usuário/senha do ambiente de origem do backup.

**Avatares:** o restore não copia arquivos de `services/backend/uploads/`; copie manualmente com `scp` para o volume do backend se necessário.

## Custos e limites (CPX12)

- ~US$ 11/mês (servidor + IPv4); crédito US$ 25 cobre ~2 meses.
- 2 GB RAM: importação pesada de PDF/OCR pode falhar; swap ajuda.
- Cost-Optimized (CX23) não estava disponível na região/conta no provisionamento.

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| `plumo-online-postgres` unhealthy na 1ª subida | Postgres 18 exige volume em `/var/lib/postgresql` (não `/var/lib/postgresql/data`). Após `git pull`, se ainda não há dados de prod: `docker compose --env-file .env.online -f docker-compose.online.yml down` → `docker volume rm plumo_online_pgdata` → `up -d --build`. Logs: `docker compose ... logs postgres --tail 80` |
| Certificado TLS | Confirme `PUBLIC_HOST` e portas 80/443 no firewall |
| 502 no login | Logs: `docker compose ... logs backend auth` |
| CORS | `CORS_ORIGINS` deve ser exatamente `PUBLIC_URL` |
| Restore falhou | Postgres up? `docker compose ... ps` |

## Referências

- [ambientes.md](ambientes.md) — dev/prod local
- [arquitetura.md](arquitetura.md)
- [whatsapp-evolution.md](whatsapp-evolution.md) — apenas local por enquanto