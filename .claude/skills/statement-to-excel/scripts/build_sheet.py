#!/usr/bin/env python3
"""Build the Artha import sheet (.xlsx + normalised .csv) from a rows CSV.

Input CSV (header required): Date,Amount,Category,Account,Note
  Date    YYYY-MM-DD
  Amount  positive number (expenses only; exclude credits/payments)
  Account same value for every row from one statement (e.g. "HDFC Savings")

Usage:
    python3 build_sheet.py rows.csv [--out OUT.xlsx]

Prints the row count, grand total, and per-category breakdown so you can
reconcile against the statement's own debit total before delivering.
"""
import argparse
import csv
import os
from collections import Counter

HEADER = ["Date", "Amount", "Category", "Account", "Note"]


def parse_amount(raw: str, row_no: int) -> float:
    cleaned = (raw or "").replace(",", "").replace("₹", "").replace("$", "").strip()
    try:
        return round(float(cleaned), 2)
    except ValueError as exc:
        raise SystemExit(f"Row {row_no}: bad Amount {raw!r}") from exc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rows")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or (os.path.splitext(args.rows)[0] + ".xlsx")

    rows = []
    with open(args.rows, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for i, r in enumerate(reader, start=2):
            date = (r.get("Date") or "").strip()
            amount = parse_amount(r.get("Amount", ""), i)
            if amount <= 0:
                raise SystemExit(f"Row {i}: Amount must be > 0 (got {amount}).")
            rows.append([
                date,
                amount,
                (r.get("Category") or "").strip(),
                (r.get("Account") or "").strip(),
                (r.get("Note") or "").strip(),
            ])

    if not rows:
        raise SystemExit("No rows found in input CSV.")

    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Expenses"
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    for col, width in zip("ABCDE", [12, 12, 18, 24, 60]):
        ws.column_dimensions[col].width = width
    wb.save(out)

    csv_out = os.path.splitext(out)[0] + ".csv"
    with open(csv_out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        writer.writerows(rows)

    total = sum(r[1] for r in rows)
    print(f"rows: {len(rows)}")
    print(f"total: {total:.2f}")
    print(f"xlsx: {out}")
    print(f"csv:  {csv_out}")
    print("by_category:")
    counts = Counter(r[2] for r in rows)
    for cat, n in counts.most_common():
        cat_total = sum(r[1] for r in rows if r[2] == cat)
        print(f"  {cat or '(none)'}: {cat_total:.2f} ({n})")


if __name__ == "__main__":
    main()
