# -*- coding: utf-8 -*-
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.pdf_password import pdf_requires_password, extract_pdf_text
from app.converters.fatura_pdf import inspect_invoice_pdf, detect_invoice_issuer, extract_invoice_metadata
from app.converters.cartao_converter import CartaoConverter
from app.utils.mapping_helper import MappingHelper
import tempfile
import shutil

PWD = "32935270860"
FOLDER = os.path.join(os.path.dirname(__file__), "..", "..", "..", "old_invoices")


def main() -> None:
    for name in sorted(os.listdir(FOLDER)):
        if not name.lower().endswith(".pdf"):
            continue
        path = os.path.join(FOLDER, name)
        print("===", name)
        print("requires_password:", pdf_requires_password(path))
        try:
            text = extract_pdf_text(path, PWD)
            print("text len:", len(text))
            sample = text[:2500].replace("\n", " | ")
            print("sample:", sample[:1200])
            issuer = detect_invoice_issuer(text)
            meta = extract_invoice_metadata(text, issuer if issuer != "unknown" else "btg")
            info = inspect_invoice_pdf(path, PWD)
            print("issuer:", issuer)
            print("meta:", meta)
            print("inspect:", info)
        except Exception as ex:
            print("ERROR:", type(ex).__name__, ex)

    # quick parse test first file
    name = sorted(os.listdir(FOLDER))[0]
    path = os.path.join(FOLDER, name)
    tmp = tempfile.mkdtemp()
    try:
        conv = CartaoConverter(MappingHelper())
        df = conv.process_pdf_files(
            [path],
            tmp,
            years=["2021"],
            months=["04"],
            passwords=[PWD],
        )
        print("parse rows:", len(df))
    except Exception as ex:
        print("parse ERROR:", type(ex).__name__, ex)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
