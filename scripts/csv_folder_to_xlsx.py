#!/usr/bin/env python3
"""
Converte todos os arquivos .csv de uma pasta (recursivo) para .xlsx no mesmo diretório.

Dependência: openpyxl (`pip install openpyxl`).

Uso:
    python scripts/csv_folder_to_xlsx.py "C:\\Downloads\\extratos"
    python scripts/csv_folder_to_xlsx.py ./dados/beneficios --dry-run
    python scripts/csv_folder_to_xlsx.py ./dados --overwrite
    python scripts/csv_folder_to_xlsx.py ./dados -c
        (um único combinado.xlsx na raiz da pasta informada, com os .csv de todas as subpastas
         numa única aba ordenada por data asc; Data + Hora viram uma coluna "Data e hora" do Excel)
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from datetime import datetime, time
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
COMBINED_SHEET_TITLE = "Dados"
MERGED_DATE_HEADER = "Data e hora"

DATE_HEADERS = ("data e hora", "data", "date", "data lancamento", "data da transacao", "data/hora")
TIME_HEADERS = ("hora", "horario", "time")
DATE_FORMATS = (
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%d/%m/%y %H:%M",
    "%d/%m/%y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
)
TIME_FORMATS = ("%H:%M:%S", "%H:%M")


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


def normalize_header(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.lower().split())


def parse_date(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_time(value: str) -> time | None:
    text = (value or "").strip()
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            continue
    return None


def split_header(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    """Primeira linha não vazia é o cabeçalho; descarta linhas vazias."""
    non_empty = [row for row in rows if any(cell.strip() for cell in row)]
    if not non_empty:
        return [], []
    header = [cell.strip() for cell in non_empty[0]]
    return header, non_empty[1:]


def find_column(header: list[str], candidates: tuple[str, ...]) -> int | None:
    normalized = [normalize_header(h) for h in header]
    for candidate in candidates:
        if candidate in normalized:
            return normalized.index(candidate)
    return None


def guess_date_column(header: list[str], rows: list[list[str]]) -> int | None:
    """Coluna de data pelo nome; sem nome conhecido, a coluna com mais valores de data."""
    by_name = find_column(header, DATE_HEADERS)
    if by_name is not None:
        return by_name
    normalized = [normalize_header(h) for h in header]
    for idx, name in enumerate(normalized):
        if name.startswith("data"):
            return idx
    best_idx, best_hits = None, 0
    sample = rows[:200]
    for idx in range(len(header)):
        hits = sum(1 for row in sample if idx < len(row) and parse_date(row[idx]))
        if hits > best_hits:
            best_idx, best_hits = idx, hits
    return best_idx if sample and best_hits >= len(sample) / 2 else None


def output_layout(
    columns: list[str], date_idx: int | None, time_idx: int | None
) -> tuple[list[str], int | None, int | None]:
    """
    Cabeçalho de saída. Com colunas separadas de data e hora, elas viram uma só
    ("Data e hora", na posição da data). Retorna (cabeçalho, índice da data na saída, coluna removida).
    """
    if date_idx is None or time_idx is None:
        return list(columns), date_idx, None
    header = [name for i, name in enumerate(columns) if i != time_idx]
    out_date_idx = date_idx - 1 if time_idx < date_idx else date_idx
    header[out_date_idx] = MERGED_DATE_HEADER
    return header, out_date_idx, time_idx


def typed_row(
    row: list[str], moment: datetime | None, date_idx: int | None, dropped_idx: int | None
) -> list[object]:
    """Data (com a hora embutida) como valor nativo do Excel; o resto segue como texto."""
    out: list[object] = list(row)
    if date_idx is not None and moment is not None and date_idx < len(out):
        out[date_idx] = moment
    if dropped_idx is not None and dropped_idx < len(out):
        del out[dropped_idx]
    return out


def apply_date_format(ws, row_number: int, out_date_idx: int | None) -> None:
    if out_date_idx is None:
        return
    cell = ws.cell(row=row_number, column=out_date_idx + 1)
    if isinstance(cell.value, datetime):
        has_time = cell.value.time() != time.min
        cell.number_format = "dd/mm/yyyy hh:mm" if has_time else "dd/mm/yyyy"


def row_sort_key(row: list[str], date_idx: int | None, time_idx: int | None) -> datetime | None:
    if date_idx is None or date_idx >= len(row):
        return None
    moment = parse_date(row[date_idx])
    if moment is None:
        return None
    if time_idx is not None and time_idx < len(row) and moment.time() == time.min:
        parsed_time = parse_time(row[time_idx])
        if parsed_time is not None:
            moment = datetime.combine(moment.date(), parsed_time)
    return moment


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
    """
    Gera combinado.xlsx em `directory` com uma única aba: todas as linhas dos CSVs informados
    (inclusive de subpastas), ordenadas por data (mais antiga primeiro).
    Colunas são alinhadas pelo nome do cabeçalho.
    """
    out_path = directory / COMBINED_XLSX_NAME
    if out_path.exists() and not overwrite:
        return "skipped"

    if dry_run:
        print(f"  PLAN {out_path} <- {len(csv_paths)} arquivo(s):")
        for path in csv_paths:
            print(f"    {path.relative_to(directory)}")
        return "would_create"

    try:
        columns: list[str] = []
        records: list[dict[str, str]] = []
        for csv_path in csv_paths:
            rows, encoding, delimiter = read_csv_rows(csv_path)
            header, data_rows = split_header(rows)
            for name in header:
                if name not in columns:
                    columns.append(name)
            for row in data_rows:
                records.append({name: (row[i] if i < len(row) else "") for i, name in enumerate(header)})
            print(
                f"    {csv_path.relative_to(directory)} "
                f"({encoding}, delim={delimiter!r}, {len(data_rows)} linhas)"
            )

        table = [[record.get(name, "") for name in columns] for record in records]
        date_idx = guess_date_column(columns, table)
        time_idx = find_column(columns, TIME_HEADERS)
        keyed = [(row_sort_key(row, date_idx, time_idx), idx, row) for idx, row in enumerate(table)]
        # Extratos vêm do mais recente para o mais antigo: no empate de data/hora, inverte a ordem do arquivo.
        dated = sorted(
            (item for item in keyed if item[0] is not None),
            key=lambda item: (item[0], -item[1]),
        )
        undated = [item for item in keyed if item[0] is None]

        header, out_date_idx, dropped_idx = output_layout(columns, date_idx, time_idx)

        wb = Workbook()
        ws = wb.active
        ws.title = COMBINED_SHEET_TITLE
        ws.append(header)
        for moment, _, row in dated + undated:
            ws.append(typed_row(row, moment, date_idx, dropped_idx))
            apply_date_format(ws, ws.max_row, out_date_idx)

        wb.save(out_path)
        date_label = header[out_date_idx] if out_date_idx is not None else "nenhuma"
        print(
            f"  OK  {out_path} ({len(table)} linhas de {len(csv_paths)} arquivo(s); "
            f"ordenado por {date_label!r} asc"
            + (f", sem data: {len(undated)}" if undated else "")
            + ")"
        )
        return "created"
    except Exception as exc:
        print(f"  ERRO {directory}: {exc}", file=sys.stderr)
        return f"error:{exc}"


def collect_csv_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.csv") if p.is_file())


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
            f"Gera um único {COMBINED_XLSX_NAME} na raiz da pasta informada "
            "(todos os .csv, inclusive de subpastas, numa única aba ordenada por data asc)"
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


def run_combine(root: Path, csv_files: list[Path], args: argparse.Namespace) -> dict[str, int]:
    stats = {"created": 0, "skipped": 0, "would_create": 0, "errors": 0}
    status = combine_folder(root, csv_files, overwrite=args.overwrite, dry_run=args.dry_run)
    if status == "created":
        stats["created"] += 1
    elif status == "skipped":
        stats["skipped"] += 1
        print(f"  SKIP {root / COMBINED_XLSX_NAME} (já existe; use --overwrite)")
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
        print(f"Modo: combinar tudo -> {root / COMBINED_XLSX_NAME}")
    if args.dry_run:
        print("(dry-run — nenhum arquivo será gravado)")

    stats = run_combine(root, csv_files, args) if args.combine else run_individual(csv_files, args)

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
