#!/usr/bin/env python3
"""Metadados de backup (sem segredos) — commitável ao lado do .backup."""
from __future__ import annotations

import argparse
import re
from datetime import datetime, timezone
from pathlib import Path


def meta_path_for(backup: Path) -> Path:
    return backup.with_suffix(".meta")


def infer_source_env(backup: Path) -> str | None:
    meta = meta_path_for(backup)
    if meta.is_file():
        for line in meta.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SOURCE_ENV="):
                return line.split("=", 1)[1].strip()
    name = backup.name
    m = re.match(r"^plumo_(prod|dev|online)_", name, re.I)
    if m:
        return m.group(1).lower()
    return None


def write_meta(backup_base: Path, source_env: str, db_name: str) -> Path:
    """backup_base = path without .backup suffix."""
    meta = Path(f"{backup_base}.meta")
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    content = (
        f"# Metadados do backup (sem segredos)\n"
        f"SOURCE_ENV={source_env}\n"
        f"CREATED_AT={now}\n"
        f"DB_NAME={db_name}\n"
    )
    meta.write_text(content, encoding="utf-8")
    return meta


def cmd_read(backup: Path) -> None:
    env = infer_source_env(backup)
    if not env:
        raise SystemExit(f"Não foi possível inferir SOURCE_ENV de {backup}")
    print(env)


def main() -> None:
    p = argparse.ArgumentParser(description="Backup metadata (SOURCE_ENV)")
    sub = p.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("write")
    w.add_argument("--base", required=True, type=Path, help="Caminho base sem .backup")
    w.add_argument("--source", required=True, choices=["prod", "dev", "online"])
    w.add_argument("--db-name", required=True)

    r = sub.add_parser("read")
    r.add_argument("backup", type=Path)

    args = p.parse_args()
    if args.cmd == "write":
        out = write_meta(args.base, args.source, args.db_name)
        print(out)
    else:
        cmd_read(args.backup)


if __name__ == "__main__":
    main()