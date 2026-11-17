#!/usr/bin/env python3
"""
Copia chaves de criptografia/JWT entre ambientes (arquivos na raiz do repo).
Não gera sidecar de backup — use antes/depois de restore conforme --from / --to.

Exemplos:
  python sync-env-keys.py --from prod --to online
  python sync-env-keys.py --from prod --to dev --set RUN_MIGRATIONS=0
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILES = {
    "prod": ROOT / ".env.prod",
    "dev": ROOT / ".env.dev",
    "online": ROOT / ".env.online",
}
DEFAULT_KEYS = ("JWT_SECRET_KEY", "ENCRYPTION_KEY", "JWT_ALGORITHM")

# merge_env_file.py no mesmo diretório
sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_env_file import merge, write_env  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description="Sincroniza JWT/ENCRYPTION entre .env.*")
    p.add_argument("--from", dest="from_env", required=True, choices=sorted(ENV_FILES))
    p.add_argument("--to", dest="to_env", required=True, choices=sorted(ENV_FILES))
    p.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Atualiza chave extra no destino (ex.: RUN_MIGRATIONS=0)",
    )
    p.add_argument(
        "--create-target-from",
        choices=("online",),
        default=None,
        help="Se destino não existe, copia env.online.example (só --to online)",
    )
    args = p.parse_args()

    if args.from_env == args.to_env:
        raise SystemExit("--from e --to devem ser ambientes diferentes")

    source = ENV_FILES[args.from_env]
    target = ENV_FILES[args.to_env]

    if not source.is_file():
        raise SystemExit(f"Fonte inexistente: {source}")

    if not target.is_file():
        if args.create_target_from == "online" and args.to_env == "online":
            template = ROOT / "env.online.example"
            if not template.is_file():
                raise SystemExit("env.online.example não encontrado")
            target.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"Criado {target} a partir de env.online.example")
        else:
            raise SystemExit(f"Destino inexistente: {target}")

    extra: dict[str, str] = {}
    for item in args.set:
        if "=" not in item:
            raise SystemExit(f"--set inválido: {item}")
        k, _, v = item.partition("=")
        extra[k.strip()] = v.strip()

    keys = list(DEFAULT_KEYS)
    lines = merge(target, source, keys, extra)
    write_env(target, lines)
    print(f"Chaves {', '.join(keys)}: {args.from_env} ({source.name}) → {args.to_env} ({target.name})")
    if extra:
        print(f"Extras: {', '.join(extra)}")


if __name__ == "__main__":
    main()