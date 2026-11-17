# Scripts de banco (local + online)

## Flags

| Flag | Backup | Restore |
|------|--------|---------|
| `--from prod\|dev` | Qual banco exportar | — |
| `--to dev\|prod\|online` | — | Onde restaurar + qual `.env.*` manda o Postgres |
| `--keys prod\|dev` | — | De qual `.env.*` copiar JWT/ENCRYPTION (origem dos **dados**) |

Arquivo **`backups/<nome>.meta`** (sem segredos, pode ir no Git): `SOURCE_ENV`, `CREATED_AT`, `DB_NAME`.

## Backup (PC)

```powershell
scripts\database\backup-database.bat --from prod
scripts\database\backup-database.bat --from prod --for-online
```

Gera `.backup`, `.sql` e `.meta`.

## Restore local (PC)

```powershell
scripts\database\restore-database.bat backups\plumo_prod_....backup --to dev --keys prod
```

Inferência: se `--keys` omitido, lê `.meta`.

Sync interno: `sync-env-keys.py` (não rodar à mão).

## Restore online

**PC (antes do VPS):**

```powershell
git add backups && git commit && git push
.\scripts\database\ship-online-env.ps1 -Keys prod
```

Envia `.env.online` por `scp` (JWT/ENCRYPTION de `.env.prod` no PC). **Não** envia `.env.prod` ao VPS.

**VPS:**

```bash
git pull
./scripts/database/restore-online.sh backups/plumo_prod_....backup --to online --keys prod
docker compose --env-file .env.online -f docker-compose.online.yml up -d
```

No VPS só existe `.env.online`: o restore **valida** chaves ou sincroniza se `.env.prod` existir (raro).

## Ferramentas internas

- `sync-env-keys.py` — merge JWT/ENCRYPTION entre `.env.*`
- `backup_meta.py` — ler/gravar `.meta`
- `validate_env_keys.py` — rejeita placeholders no VPS

Ver [docs/hospedagem-online.md](../../docs/hospedagem-online.md).