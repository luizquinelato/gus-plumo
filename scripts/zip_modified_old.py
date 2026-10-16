"""Zipa os arquivos modificados do git e restaura em outro lugar.

Uso (na raiz do repositório):
    python scripts/zip_modified.py pack [--out nome.zip]
    python scripts/zip_modified.py unpack arquivo.zip [--dest PASTA]

Regras de extensão dentro do zip (para passar por filtros que bloqueiam .py):
    .py  -> .txt
    .txt -> .txt2   (txt original, evita colisão com os .py renomeados)
O zip leva um MAPPING.md na raiz com: arquivo no zip | destino | extensão destino.
O unpack lê o MAPPING.md, então a reversão é exata (.txt -> .py, .txt2 -> .txt).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

MAPPING_NAME = "MAPPING.md"
EXT_TO_ZIP = {".py": ".txt", ".txt": ".txt2"}


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(out)


def modified_files(root: Path) -> list[str]:
    """Caminhos (relativos à raiz, com /) de `git status --short`, sem deletados."""
    raw = subprocess.run(
        ["git", "status", "--short", "--untracked-files=all", "-z"],
        capture_output=True, text=True, encoding="utf-8", cwd=root, check=True,
    ).stdout
    parts = raw.split("\0")
    files: list[str] = []
    i = 0
    while i < len(parts):
        entry = parts[i]
        i += 1
        if len(entry) < 4:
            continue
        status, path = entry[:2], entry[3:]
        if status[0] in "RC":  # rename/copy: o próximo item é o caminho antigo
            i += 1
        if "D" in status:
            continue
        if (root / path).is_file():
            files.append(path)
    return sorted(set(files))


def zip_name_for(path: str) -> tuple[str, str]:
    """Retorna (nome no zip, extensão no zip)."""
    p = PurePosixPath(path)
    new_ext = EXT_TO_ZIP.get(p.suffix, p.suffix)
    return str(p.with_suffix(new_ext)), new_ext


def build_mapping(rows: list[tuple[str, str, str, str]]) -> str:
    lines = [
        "# Mapping",
        "",
        "| arquivo no zip | destino | extensão no zip | extensão destino |",
        "|---|---|---|---|",
    ]
    lines += [f"| {z} | {d} | {ze or '-'} | {de or '-'} |" for z, d, ze, de in rows]
    return "\n".join(lines) + "\n"


def parse_mapping(text: str) -> list[tuple[str, str]]:
    pairs = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2 or cells[0] in ("arquivo no zip", "---"):
            continue
        pairs.append((cells[0], cells[1]))
    return pairs


def pack(out: str | None) -> int:
    root = repo_root()
    files = modified_files(root)
    if not files:
        print("Nenhum arquivo modificado.")
        return 0
    target = root / (out or f"modified_{datetime.now():%Y%m%d_%H%M%S}.zip")
    rows = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zip_path, zip_ext = zip_name_for(path)
            zf.write(root / path, zip_path)
            rows.append((zip_path, path, zip_ext, PurePosixPath(path).suffix))
        zf.writestr(MAPPING_NAME, build_mapping(rows))
    print(f"{len(files)} arquivo(s) -> {target}")
    return 0


def unpack(zip_file: str, dest: str | None) -> int:
    base = Path(dest).resolve() if dest else repo_root()
    with zipfile.ZipFile(zip_file) as zf:
        pairs = parse_mapping(zf.read(MAPPING_NAME).decode("utf-8"))
        for zip_path, dst in pairs:
            target = (base / dst).resolve()
            if base != target and base not in target.parents:
                print(f"Ignorado (fora do destino): {dst}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(zip_path))
            print(f"{zip_path} -> {target}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_pack = sub.add_parser("pack", help="zipa arquivos do git status --short")
    p_pack.add_argument("--out", help="nome do zip (criado na raiz do repo)")
    p_unpack = sub.add_parser("unpack", help="restaura arquivos de um zip")
    p_unpack.add_argument("zip_file")
    p_unpack.add_argument("--dest", help="pasta base (padrão: raiz do repo)")
    args = parser.parse_args()
    return pack(args.out) if args.cmd == "pack" else unpack(args.zip_file, args.dest)


if __name__ == "__main__":
    sys.exit(main())
