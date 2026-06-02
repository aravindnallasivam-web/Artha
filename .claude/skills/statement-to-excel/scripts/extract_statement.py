#!/usr/bin/env python3
"""Extract text and render page images from a statement PDF.

Usage:
    python3 extract_statement.py STATEMENT.pdf [--outdir DIR] [--dpi N]

Writes:
    <outdir>/text.txt      concatenated per-page text (empty/sparse for scans)
    <outdir>/page{N}.png   full-page render (always, for the visual fallback)

Prints a summary: page count, how much real text was extractable, and a hint on
which path (text-parse vs read-the-images) to take next.
"""
import argparse
import os
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--outdir", default="/tmp/statement_work")
    ap.add_argument("--dpi", type=int, default=200)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    # --- 1. Text via pypdf -------------------------------------------------
    text = ""
    pages = 0
    try:
        import pypdf

        reader = pypdf.PdfReader(args.pdf)
        pages = len(reader.pages)
        parts = []
        for i, page in enumerate(reader.pages):
            parts.append(f"=== PAGE {i + 1} ===")
            try:
                parts.append(page.extract_text() or "")
            except Exception as exc:  # noqa: BLE001
                parts.append(f"[extract error: {exc}]")
        text = "\n".join(parts)
    except Exception as exc:  # noqa: BLE001
        print(f"pypdf text extraction failed: {exc}", file=sys.stderr)

    text_path = os.path.join(args.outdir, "text.txt")
    with open(text_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    text_chars = len(text.replace("=== PAGE", "").strip())

    # --- 2. Render pages via PyMuPDF (works for scanned/vector PDFs too) ---
    rendered = []
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(args.pdf)
        pages = doc.page_count
        mat = fitz.Matrix(args.dpi / 72, args.dpi / 72)
        for i in range(doc.page_count):
            out = os.path.join(args.outdir, f"page{i + 1}.png")
            doc[i].get_pixmap(matrix=mat).save(out)
            rendered.append(out)
    except Exception as exc:  # noqa: BLE001
        print(f"pymupdf render failed: {exc}", file=sys.stderr)

    # --- 3. Summary --------------------------------------------------------
    print(f"pages: {pages}")
    print(f"extractable_text_chars: {text_chars}")
    print(f"text_file: {text_path}")
    print("rendered_pages:")
    for path in rendered:
        print(f"  {path}")
    if text_chars < 200:
        print(
            "HINT: little/no extractable text -> scanned/vector PDF. Read the "
            "page PNGs visually; use render_region.py to zoom small amounts."
        )
    else:
        print(
            "HINT: text extracted -> parse transactions from text_file with a "
            "regex, then cross-check against a rendered page."
        )


if __name__ == "__main__":
    main()
