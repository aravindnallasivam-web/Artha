#!/usr/bin/env python3
"""Render a zoomed crop of one page, for reading small figures (amounts).

Usage:
    python3 render_region.py STATEMENT.pdf PAGE X0 Y0 X1 Y1 [--zoom Z] [--out PATH]

Coords are fractions 0..1 of the page width/height. Examples:
    bottom band of page 1:   render_region.py s.pdf 1 0   0.86 1 1
    top third of page 2:     render_region.py s.pdf 2 0   0.12 1 0.45
"""
import argparse
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("page", type=int, help="1-based page number")
    ap.add_argument("x0", type=float)
    ap.add_argument("y0", type=float)
    ap.add_argument("x1", type=float)
    ap.add_argument("y1", type=float)
    ap.add_argument("--zoom", type=float, default=4.0)
    ap.add_argument("--out", default="/tmp/statement_work/crop.png")
    args = ap.parse_args()

    import fitz  # PyMuPDF

    doc = fitz.open(args.pdf)
    page = doc[args.page - 1]
    rect = page.rect
    clip = fitz.Rect(
        args.x0 * rect.width,
        args.y0 * rect.height,
        args.x1 * rect.width,
        args.y1 * rect.height,
    )
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    page.get_pixmap(matrix=fitz.Matrix(args.zoom, args.zoom), clip=clip).save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()
