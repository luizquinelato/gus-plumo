#!/usr/bin/env bash
# Restore no Postgres do docker-compose.online.yml (VPS).
# Uso: ./scripts/database/restore-online.sh backups/arquivo.backup --to online [--keys prod]
#
# No VPS só existe .env.online — chaves devem vir do PC (ship-online-env.ps1).

set -euo pipefail

CONTAINER_NAME="${PLUMO_ONLINE_PG_CONTAINER:-plumo-online-postgres}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.online.yml}"
ENV_FILE="${ENV_FILE:-.env.online}"
KEYS_ENV=""
RESTORE_TO="online"
BACKUP_PATH=""

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
SYNC_PY="$ROOT_DIR/scripts/database/sync-env-keys.py"
META_PY="$ROOT_DIR/scripts/database/backup_meta.py"
VALIDATE_PY="$ROOT_DIR/scripts/database/validate_env_keys.py"

usage() {
  echo "Uso: $0 <backup.backup> [--to online] [--keys prod|dev|online] [--no-validate-keys]"
  exit 1
}

NO_VALIDATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keys)
      KEYS_ENV="${2:?}"
      shift 2
      ;;
    --from)
      KEYS_ENV="${2:?}"
      shift 2
      ;;
    --to)
      RESTORE_TO="${2:?}"
      shift 2
      ;;
    --no-validate-keys)
      NO_VALIDATE=1
      shift
      ;;
    --no-sync-keys)
      NO_VALIDATE=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [[ -z "$BACKUP_PATH" ]]; then
        BACKUP_PATH="$1"
      else
        echo "Argumento desconhecido: $1"
        usage
      fi
      shift
      ;;
  esac
done

[[ -n "$BACKUP_PATH" ]] || usage

if [[ "$RESTORE_TO" != "online" ]]; then
  echo "restore-online.sh suporta apenas --to online"
  exit 1
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Arquivo não encontrado: $BACKUP_PATH"
  exit 1
fi

if [[ -z "$KEYS_ENV" ]] && command -v python3 >/dev/null 2>&1 && [[ -f "$META_PY" ]]; then
  KEYS_ENV="$(python3 "$META_PY" read "$BACKUP_PATH" 2>/dev/null || true)"
fi
if [[ -z "$KEYS_ENV" ]]; then
  KEYS_ENV="prod"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Crie $ENV_FILE a partir de env.online.example"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

DB_NAME="${DB_NAME:-plumo}"
DB_USER="${DB_USER:-plumo}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container $CONTAINER_NAME não está rodando."
  exit 1
fi

echo "========================================"
echo "  ATENÇÃO: substitui todos os dados em $DB_NAME"
echo "  Destino: --to $RESTORE_TO | Chaves: --keys $KEYS_ENV"
echo "========================================"
read -r -p "Continuar? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" && "$CONFIRM" != "y" ]]; then
  echo "Cancelado."
  exit 0
fi

if [[ "$NO_VALIDATE" != "1" ]]; then
  FROM_FILE="$ROOT_DIR/.env.$KEYS_ENV"
  if [[ -f "$FROM_FILE" ]] && [[ -f "$SYNC_PY" ]] && command -v python3 >/dev/null 2>&1; then
    echo "Sincronizando .env.$KEYS_ENV → .env.online (raro no VPS)..."
    python3 "$SYNC_PY" --from "$KEYS_ENV" --to online --set RUN_MIGRATIONS=0
  else
    if [[ -f "$VALIDATE_PY" ]] && command -v python3 >/dev/null 2>&1; then
      if ! python3 "$VALIDATE_PY" "$ENV_FILE"; then
        echo ""
        echo "Rode no PC antes do restore:"
        echo "  .\\scripts\\database\\ship-online-env.ps1 -Keys $KEYS_ENV"
        exit 1
      fi
    fi
    if grep -q '^RUN_MIGRATIONS=' "$ENV_FILE"; then
      sed -i.bak 's/^RUN_MIGRATIONS=.*/RUN_MIGRATIONS=0/' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      echo "RUN_MIGRATIONS=0" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE" 2>/dev/null || true
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop backend auth web 2>/dev/null || true

docker cp "$BACKUP_PATH" "$CONTAINER_NAME:/tmp/restore.backup"

docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"

docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"

docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  pg_restore -U "$DB_USER" -d "$DB_NAME" -v /tmp/restore.backup || true

docker exec "$CONTAINER_NAME" rm -f /tmp/restore.backup

echo ""
echo "Restore concluído. Suba a stack:"
echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d"