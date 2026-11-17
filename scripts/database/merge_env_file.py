#!/usr/bin/env python3
"""
Atualiza variáveis em um arquivo .env (destino) a partir de outro (fonte).
Uso:
  python merge_env_file.py --target .env.online --source .env.prod --keys JWT_SECRET_KEY,ENCRYPTION_KEY
  python merge_env_file.py --target .env.online --source backup.keys.env --keys JWT_SECRET_KEY,ENCRYPTION_KEY --set RUN_MIGRATIONS=0
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path


def parse_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        key, _, value = s.partition("=")
        key = key.strip().lstrip("\ufeff")
        data[key] = value.strip()
    return data


def write_env(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def merge(
    target: Path,
    source: Path,
    keys: list[str],
    extra_sets: dict[str, str],
) -> list[str]:
    target_lines: list[str] = []
    if target.is_file():
        target_lines = target.read_text(encoding="utf-8").splitlines()

    source_data = parse_env(source)
    missing = [k for k in keys if k not in source_data or not source_data[k]]
    if missing:
        raise SystemExit(f"Fonte {source} sem valores para: {', '.join(missing)}")

    all_updates = {**{k: source_data[k] for k in keys}, **extra_sets}
    seen: set[str] = set()

    new_lines: list[str] = []
    key_pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=")

    for line in target_lines:
        m = key_pattern.match(line.strip())
        if not m:
            new_lines.append(line)
            continue
        key = m.group(1)
        if key in all_updates:
            new_lines.append(f"{key}={all_updates[key]}")
            seen.add(key)
        else:
            new_lines.append(line)

    for key, value in all_updates.items():
        if key not in seen:
            new_lines.append(f"{key}={value}")

    return new_lines


def main() -> None:
    p = argparse.ArgumentParser(description="Mescla chaves entre arquivos .env")
    p.add_argument("--target", required=True, type=Path)
    p.add_argument("--source", required=True, type=Path)
    p.add_argument("--keys", required=True, help="Lista separada por vírgula")
    p.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Define par extra no destino (repetível)",
    )
    args = p.parse_args()

    keys = [k.strip() for k in args.keys.split(",") if k.strip()]
    extra: dict[str, str] = {}
    for item in args.set:
        if "=" not in item:
            raise SystemExit(f"--set inválido: {item}")
        k, _, v = item.partition("=")
        extra[k.strip()] = v.strip()

    lines = merge(args.target, args.source, keys, extra)
    write_env(args.target, lines)
    print(f"Atualizado: {args.target} ({len(keys) + len(extra)} chave(s))")


if __name__ == "__main__":
    main()