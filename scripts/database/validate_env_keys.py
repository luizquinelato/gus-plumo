#!/usr/bin/env python3
"""Valida JWT/ENCRYPTION em .env (sem placeholders)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PLACEHOLDER_MARKERS = (
    "troque",
    "COLE_",
    "COLE_OU",
    "generate-key",
    "openssl-rand",
)


def parse_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, val = s.partition("=")
        data[key.strip().lstrip("\ufeff")] = val.strip()
    return data


def is_placeholder(value: str) -> bool:
    v = value.lower()
    if not value or len(value) < 8:
        return True
    return any(m.lower() in v for m in PLACEHOLDER_MARKERS)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("env_file", type=Path)
    args = p.parse_args()
    if not args.env_file.is_file():
        print(f"Arquivo não encontrado: {args.env_file}", file=sys.stderr)
        return 1
    data = parse_env(args.env_file)
    ok = True
    for key in ("JWT_SECRET_KEY", "ENCRYPTION_KEY"):
        val = data.get(key, "")
        if is_placeholder(val):
            print(f"[ERRO] {key} inválido ou placeholder em {args.env_file}", file=sys.stderr)
            ok = False
    if ok:
        print("OK")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())