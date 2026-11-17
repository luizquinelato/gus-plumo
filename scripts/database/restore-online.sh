#!/usr/bin/env bash
# Restore no Postgres do docker-compose.online.yml (VPS).
# Uso: ./scripts/database/restore-online.sh backups/arquivo.backup

set -euo pipefail

CONTAINER_NAME="${PLUMO_ONLINE_PG_CONTAINER:-plumo-online-postgres}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.online.yml}"
ENV_FILE="${ENV_FILE:-.env.online}"

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <caminho-backup.backup>"
  exit 1
fi

BACKUP_PATH="$1"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Arquivo não encontrado: $BACKUP_PATH"
  exit 1
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
  echo "Container $CONTAINER_NAME não está rodando. Suba: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d postgres"
  exit 1
fi

echo "========================================"
echo "  ATENÇÃO: substitui todos os dados em $DB_NAME"
echo "========================================"
read -r -p "Continuar? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" && "$CONFIRM" != "y" ]]; then
  echo "Cancelado."
  exit 0
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
echo "Restore concluído. Defina RUN_MIGRATIONS=0 em .env.online e suba de novo:"
echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d"