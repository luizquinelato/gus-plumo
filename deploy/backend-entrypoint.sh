#!/bin/sh
set -e

cd /app/services/backend

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "Running migrations..."
  python scripts/migration_runner.py --apply-all
else
  echo "SKIP migrations (RUN_MIGRATIONS=${RUN_MIGRATIONS})"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"