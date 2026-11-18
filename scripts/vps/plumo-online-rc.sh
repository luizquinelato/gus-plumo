#!/usr/bin/env bash
# Plumo — helpers bash SOMENTE para stack online (.env.online + docker-compose.online.yml).
# Uso: source este arquivo no ~/.bashrc do VPS (não executa sozinho para dkup/reset).

[[ -n "${PLUMO_ONLINE_RC_LOADED:-}" ]] && return 0
PLUMO_ONLINE_RC_LOADED=1

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Carregue com: source scripts/vps/plumo-online-rc.sh" >&2
  exit 1
fi

PLUMO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

readonly PLUMO_COMPOSE_FILE="docker-compose.online.yml"
readonly PLUMO_ENV_FILE=".env.online"
readonly PLUMO_PG_CONTAINER="plumo-online-postgres"
readonly PLUMO_BACKEND_CONTAINER="plumo-online-backend"

_plumo_require_env() {
  if [[ ! -f "$PLUMO_ROOT/$PLUMO_ENV_FILE" ]]; then
    echo "[plumo-online] Falta $PLUMO_ROOT/$PLUMO_ENV_FILE" >&2
    return 1
  fi
}

_plumo_cd() {
  cd "$PLUMO_ROOT" || return 1
}

_plumo_compose() {
  _plumo_require_env || return 1
  _plumo_cd || return 1
  docker compose --env-file "$PLUMO_ENV_FILE" -f "$PLUMO_COMPOSE_FILE" "$@"
}

_plumo_backend_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PLUMO_BACKEND_CONTAINER"
}

_plumo_migrate() {
  _plumo_require_env || return 1
  _plumo_cd || return 1
  _plumo_compose run --rm --no-deps --entrypoint python backend \
    scripts/migration_runner.py "$@"
}

_plumo_exec_migrate() {
  if _plumo_backend_running; then
    docker exec "$PLUMO_BACKEND_CONTAINER" python scripts/migration_runner.py "$@"
    return $?
  fi
  echo "[plumo-online] Backend parado — usando compose run..."
  _plumo_migrate "$@"
}

_plumo_confirm() {
  local msg="$1"
  local ans
  read -r -p "$msg (yes/no): " ans
  [[ "$ans" == "yes" || "$ans" == "y" ]]
}

_plumo_set_run_migrations() {
  local val="$1"
  _plumo_require_env || return 1
  _plumo_cd || return 1
  if grep -q '^RUN_MIGRATIONS=' "$PLUMO_ENV_FILE"; then
    sed -i.bak "s/^RUN_MIGRATIONS=.*/RUN_MIGRATIONS=$val/" "$PLUMO_ENV_FILE"
    rm -f "$PLUMO_ENV_FILE.bak"
  else
    echo "RUN_MIGRATIONS=$val" >>"$PLUMO_ENV_FILE"
  fi
}

_gus_help() {
  cat <<'EOF'
Gus CLI — stack online (.env.online)

Uso: gus <comando> [args]     |     gus --help

  cd                 ir para /opt/gus-plumo
  rat                compose up -d
  rat-build          up -d --build (após git pull)
  dkup | dkdown | dkdown-v | dkstatus | dklogs
  kill-all | kill-all-hard
  dbm | dbs | dbr | dbr-to <N>
  reset | reset-full
  backup             pg_dump online
  restore [arquivo]  restore-online.sh
  health             curl /health + ps

Atalhos ainda funcionam soltos: rat-build, dkup, dbm, ...
EOF
}

gus() {
  if [[ $# -eq 0 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]] || [[ "$1" == "help" ]]; then
    _gus_help
    return 0
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    cd)
      _plumo_cd && pwd
      ;;
    rat) rat "$@" ;;
    rat-build) rat-build "$@" ;;
    dkup) dkup "$@" ;;
    dkup-build) dkup-build "$@" ;;
    dkdown) dkdown "$@" ;;
    dkdown-v) dkdown-v "$@" ;;
    dkstatus) dkstatus "$@" ;;
    dklogs) dklogs "$@" ;;
    kill-all) kill-all "$@" ;;
    kill-all-hard) kill-all-hard "$@" ;;
    dbm) dbm "$@" ;;
    dbs) dbs "$@" ;;
    dbr) dbr "$@" ;;
    dbr-to) dbr-to "$@" ;;
    reset) reset "$@" ;;
    reset-full) reset-full "$@" ;;
    backup) plumo-backup "$@" ;;
    restore) plumo-restore "$@" ;;
    health) plumo-health "$@" ;;
    *)
      if [[ $(type -t "$cmd" 2>/dev/null) == function ]]; then
        "$cmd" "$@"
        return $?
      fi
      echo "[gus] Comando desconhecido: $cmd (gus --help)" >&2
      return 1
      ;;
  esac
}

# Compat: cd rápido (como expenses no PC)
plumo() {
  _plumo_cd && pwd
}

plumo-online() {
  plumo
}

e() {
  plumo
}

plumo-help() {
  gus --help
}

dkup() {
  _plumo_compose up -d "$@"
}

dkup-build() {
  _plumo_compose up -d --build "$@"
}

rat() {
  dkup
}

rat-build() {
  dkup-build
}

dkdown() {
  _plumo_compose down "$@"
}

dkdown-v() {
  echo "[ATENCAO] Remove volumes (plumo_online_pgdata, uploads, caddy...)."
  _plumo_confirm "Confirma dkdown -v" || { echo "Cancelado."; return 0; }
  _plumo_compose down -v "$@"
}

dkstatus() {
  _plumo_compose ps "$@"
}

dklogs() {
  _plumo_compose logs -f "$@"
}

kill-all() {
  _plumo_compose stop backend auth web
}

kill-all-hard() {
  dkdown
}

dbm() {
  _plumo_exec_migrate --apply-all
}

dbr() {
  _plumo_confirm "Rollback TOTAL (0000) apaga dados de negocio" || return 0
  _plumo_exec_migrate --rollback-to 0000 --confirm
}

dbs() {
  _plumo_exec_migrate --status
}

dbr-to() {
  local n="${1:?usage: dbr-to 0002}"
  _plumo_confirm "Reverter ate migration $n" || return 0
  _plumo_exec_migrate --rollback-to "$n" --confirm
}

reset() {
  echo "[reset] Schema: stop apps -> dbr -> dbm -> up (mantem volume Postgres)."
  _plumo_confirm "Isso apaga dados via rollback de migrations" || return 0
  _plumo_compose stop backend auth web || return 1
  _plumo_migrate --rollback-to 0000 --confirm || return 1
  _plumo_migrate --apply-all || return 1
  _plumo_compose up -d
}

reset-full() {
  echo "[reset-full] Apaga volume Postgres e recria fase A (seed)."
  _plumo_confirm "Confirma reset-full (dkdown -v)" || return 0
  _plumo_compose down -v || return 1
  _plumo_set_run_migrations 1 || return 1
  _plumo_compose up -d
}

plumo-health() {
  _plumo_require_env || return 1
  _plumo_cd || return 1
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "./$PLUMO_ENV_FILE"
  set +a
  local url="${PUBLIC_URL:-https://37-27-37-103.sslip.io}/health"
  echo "[health] GET $url"
  if curl -sfS "$url"; then
    echo ""
  else
    echo "[health] Falhou" >&2
    return 1
  fi
  dkstatus
}

plumo-backup() {
  _plumo_cd || return 1
  local script="$PLUMO_ROOT/scripts/database/backup-online.sh"
  chmod +x "$script" 2>/dev/null || true
  "$script"
}

plumo-restore() {
  _plumo_cd || return 1
  local backup="$1"
  if [[ -z "$backup" ]]; then
    latest=$(ls -1t backups/*.backup 2>/dev/null | head -1)
    if [[ -z "$latest" ]]; then
      echo "Nenhum backups/*.backup encontrado." >&2
      return 1
    fi
    backup="$latest"
    echo "[plumo-restore] Usando mais recente: $backup"
  fi
  local script="$PLUMO_ROOT/scripts/database/restore-online.sh"
  [[ -x "$script" ]] || chmod +x "$script" 2>/dev/null || true
  "$script" "$backup" --to online
}

export PLUMO_ROOT
echo "[gus-online] CLI carregado. Comandos: gus --help"