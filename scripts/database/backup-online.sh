#!/usr/bin/env bash
# Backup Postgres da stack online (VPS). SOURCE_ENV=online no .meta
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.online}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.online.yml}"
CONTAINER_NAME="${PLUMO_ONLINE_PG_CONTAINER:-plumo-online-postgres}"
META_PY="$ROOT_DIR/scripts/database/backup_meta.py"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo não encontrado: $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

DB_NAME="${DB_NAME:-plumo}"
DB_USER="${DB_USER:-plumo}"
DB_PASSWORD="${DB_PASSWORD:?defina DB_PASSWORD em .env.online}"

mkdir -p backups

TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="backups/plumo_online_${TIMESTAMP}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container $CONTAINER_NAME não está rodando."
  exit 1
fi

echo "[1/3] Custom format backup..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f /tmp/backup.dump
docker cp "$CONTAINER_NAME:/tmp/backup.dump" "${BACKUP_FILE}.backup"
docker exec "$CONTAINER_NAME" rm -f /tmp/backup.dump

echo "[2/3] SQL format backup..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -F p -f /tmp/backup.sql
docker cp "$CONTAINER_NAME:/tmp/backup.sql" "${BACKUP_FILE}.sql"
docker exec "$CONTAINER_NAME" rm -f /tmp/backup.sql

echo "[3/3] .meta"
python3 "$META_PY" write --base "$BACKUP_FILE" --source online --db-name "$DB_NAME"

echo ""
echo "OK: ${BACKUP_FILE}.backup (+ .sql, .meta)"
echo "Baixe com WinSCP/pscp para o PC e restore:"
echo "  restore-database.bat backups\\...backup --to prod --keys online"