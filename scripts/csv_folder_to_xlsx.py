#!/usr/bin/env python3
"""
Converte todos os arquivos .csv de uma pasta (recursivo) para .xlsx no mesmo diretório.

Dependência: openpyxl (`pip install openpyxl`).

Uso:
    python scripts/csv_folder_to_xlsx.py "C:\\Downloads\\extratos"
    python scripts/csv_folder_to_xlsx.py ./dados/beneficios --dry-run
    python scripts/csv_folder_to_xlsx.py ./dados --overwrite
    python scripts/csv_folder_to_xlsx.py ./dados -c
        (um combinado.xlsx por pasta; cada .csv vira uma aba — pastas diferentes não se misturam)
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    from openpyxl import Workbook
except ImportError:
    print(
        "Erro: openpyxl não instalado. Execute: pip install openpyxl",
        file=sys.stderr,
    )
    sys.exit(1)

ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
COMBINED_XLSX_NAME = "combinado.xlsx"
INVALID_SHEET_CHARS = re.compile(r"[\\\/*?:\[\]]")


def read_csv_rows(path: Path) -> tuple[list[list[str]], str, str]:
    """Lê CSV; retorna (linhas, encoding usado, delimitador)."""
    last_error: Exception | None = None
    for encoding in ENCODINGS:
        try:
            raw = path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
            continue

        sample = raw[:8192]
        delimiter = ","
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
            delimiter = dialect.delimiter
        except csv.Error:
            if sample.count(";") > sample.count(","):
                delimiter = ";"

        reader = csv.reader(raw.splitlines(), delimiter=delimiter)
        rows = [list(row) for row in reader]
        return rows, encoding, delimiter

    raise ValueError(f"Não foi possível decodificar {path}: {last_error}") from last_error


def rows_to_workbook(rows: list[list[str]]) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    for row in rows:
        ws.append(row)
    return wb


def sheet_title_from_csv(csv_path: Path, used_titles: set[str]) -> str:
    """Nome de aba Excel (máx. 31 caracteres, único dentro do workbook)."""
    base = INVALID_SHEET_CHARS.sub("_", csv_path.stem).strip() or "Aba"
    base = base[:31]
    title = base
    suffix_n = 2
    while title in used_titles:
        suffix = f"_{suffix_n}"
        title = f"{base[: 31 - len(suffix)]}{suffix}"
        suffix_n += 1
    used_titles.add(title)
    return title


def convert_file(csv_path: Path, *, overwrite: bool, dry_run: bool) -> str:
    """
    Converte um CSV para XLSX. Retorna status: created | skipped | would_create | error:...
    """
    xlsx_path = csv_path.with_suffix(".xlsx")
    if xlsx_path.exists() and not overwrite:
        return "skipped"

    if dry_run:
        return "would_create"

    try:
        rows, encoding, delimiter = read_csv_rows(csv_path)
        wb = rows_to_workbook(rows)
        wb.save(xlsx_path)
        print(f"  OK  {csv_path} -> {xlsx_path.name} ({encoding}, delim={delimiter!r}, {len(rows)} linhas)")
        return "created"
    except Exception as exc:
        print(f"  ERRO {csv_path}: {exc}", file=sys.stderr)
        return f"error:{exc}"


def combine_folder(
    directory: Path,
    csv_paths: list[Path],
    *,
    overwrite: bool,
    dry_run: bool,
) -> str:
    """Gera combinado.xlsx na pasta com uma aba por CSV (somente arquivos desta pasta)."""
    out_path = directory / COMBINED_XLSX_NAME
    if out_path.exists() and not overwrite:
        return "skipped"

    if dry_run:
        sheets = [p.name for p in csv_paths]
        print(f"  PLAN {out_path} <- {len(csv_paths)} aba(s): {', '.join(sheets)}")
        return "would_create"

    try:
        wb = Workbook()
        default_sheet = wb.active
        wb.remove(default_sheet)

        used_titles: set[str] = set()
        for csv_path in csv_paths:
            rows, encoding, delimiter = read_csv_rows(csv_path)
            title = sheet_title_from_csv(csv_path, used_titles)
            ws = wb.create_sheet(title=title)
            for row in rows:
                ws.append(row)
            print(
                f"    aba {title!r} <- {csv_path.name} "
                f"({encoding}, delim={delimiter!r}, {len(rows)} linhas)"
            )

        wb.save(out_path)
        print(f"  OK  {out_path} ({len(csv_paths)} aba(s))")
        return "created"
    except Exception as exc:
        print(f"  ERRO {directory}: {exc}", file=sys.stderr)
        return f"error:{exc}"


def collect_csv_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.csv") if p.is_file())


def group_csv_by_directory(csv_files: list[Path]) -> dict[Path, list[Path]]:
    groups: dict[Path, list[Path]] = defaultdict(list)
    for path in csv_files:
        groups[path.parent].append(path)
    return dict(sorted((k, sorted(v)) for k, v in groups.items()))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Converte recursivamente arquivos .csv para .xlsx na mesma pasta.",
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Pasta raiz (busca .csv em todas as subpastas)",
    )
    parser.add_argument(
        "-c",
        "--combine",
        action="store_true",
        help=(
            f"Por pasta, gera um único {COMBINED_XLSX_NAME} "
            "(cada .csv da mesma pasta vira uma aba; subpastas ficam separadas)"
        ),
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Substituir .xlsx já existente",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apenas listar o que seria convertido, sem gravar arquivos",
    )
    return parser.parse_args()


def run_individual(csv_files: list[Path], args: argparse.Namespace) -> dict[str, int]:
    stats = {"created": 0, "skipped": 0, "would_create": 0, "errors": 0}
    for csv_path in csv_files:
        status = convert_file(csv_path, overwrite=args.overwrite, dry_run=args.dry_run)
        if status == "created":
            stats["created"] += 1
        elif status == "skipped":
            stats["skipped"] += 1
            print(f"  SKIP {csv_path} (já existe {csv_path.with_suffix('.xlsx').name}; use --overwrite)")
        elif status == "would_create":
            stats["would_create"] += 1
            print(f"  PLAN {csv_path} -> {csv_path.with_suffix('.xlsx').name}")
        else:
            stats["errors"] += 1
    return stats


def run_combine(csv_files: list[Path], args: argparse.Namespace) -> dict[str, int]:
    stats = {"created": 0, "skipped": 0, "would_create": 0, "errors": 0}
    groups = group_csv_by_directory(csv_files)
    for directory, paths in groups.items():
        print(f"Pasta {directory} ({len(paths)} csv)")
        status = combine_folder(directory, paths, overwrite=args.overwrite, dry_run=args.dry_run)
        if status == "created":
            stats["created"] += 1
        elif status == "skipped":
            stats["skipped"] += 1
            print(f"  SKIP {directory / COMBINED_XLSX_NAME} (já existe; use --overwrite)")
        elif status == "would_create":
            stats["would_create"] += 1
        else:
            stats["errors"] += 1
    return stats


def main() -> int:
    args = parse_args()
    root = args.folder.expanduser().resolve()

    if not root.is_dir():
        print(f"Pasta inválida: {root}", file=sys.stderr)
        return 1

    csv_files = collect_csv_files(root)
    if not csv_files:
        print(f"Nenhum .csv encontrado em {root}")
        return 0

    print(f"Pasta raiz: {root}")
    print(f"Arquivos .csv: {len(csv_files)}")
    if args.combine:
        print(f"Modo: combinar por pasta -> {COMBINED_XLSX_NAME}")
    if args.dry_run:
        print("(dry-run — nenhum arquivo será gravado)")

    stats = run_combine(csv_files, args) if args.combine else run_individual(csv_files, args)

    if args.dry_run:
        print(
            f"Concluído: {stats['would_create']} conversão(ões) planejada(s), "
            f"{stats['skipped']} ignorado(s), {stats['errors']} erro(s)."
        )
    else:
        print(
            f"Concluído: {stats['created']} criado(s), {stats['skipped']} ignorado(s), "
            f"{stats['errors']} erro(s)."
        )

    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
