#!/usr/bin/env bash
# Legado: use ship-online-env.ps1 no PC. No VPS, validar .env.online manualmente.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
KEYS="${1:-prod}"
if [[ -f "$ROOT_DIR/.env.$KEYS" ]]; then
  python3 "$ROOT_DIR/scripts/database/sync-env-keys.py" --from "$KEYS" --to online --set RUN_MIGRATIONS=0
else
  echo "No VPS: rode no PC: scripts/database/ship-online-env.ps1 -Keys $KEYS"
  exit 1
fi