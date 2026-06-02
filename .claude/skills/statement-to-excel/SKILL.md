---
name: statement-to-excel
description: Convert a bank or credit-card statement PDF into an Artha-ready expense import sheet (.xlsx/.csv with columns Date, Amount, Category, Account, Note). Use whenever the user uploads/points to a statement PDF and wants an importable expense spreadsheet ("create the excel", "process this statement", "make an import file"). Handles both text-based and scanned/image PDFs, excludes income/credits/payments, categorises by merchant (and UPI payee), and validates the total against the statement.
---

# Statement → Excel (Artha import sheet)

Turn a bank/credit-card statement PDF into a spreadsheet the Artha app can import
(**Expenses → Import**). The output columns are exactly:

`Date, Amount, Category, Account, Note`

- **Date** — `YYYY-MM-DD`.
- **Amount** — positive number, expenses only (no currency symbol).
- **Category** — best-guess label; auto-created on import (matched case-insensitively).
- **Account** — the source account/card name (auto-created; blank → Cash).
- **Note** — the raw narration / merchant, kept for traceability.

Helper scripts live in `scripts/` next to this file. Run them with `python3`
(use the absolute path to this skill's `scripts/` folder).

## Setup (once per environment)

```bash
pip install -r scripts/requirements.txt   # pypdf, pymupdf, openpyxl
# If pypdf errors importing cryptography: pip install cffi
```

## Procedure

### 1. Extract text and render pages
```bash
python3 scripts/extract_statement.py "<STATEMENT.pdf>" --outdir /tmp/stmt
```
It writes `/tmp/stmt/text.txt` and `/tmp/stmt/page{N}.png`, and prints the page
count + how much real text was extractable.

- **`extractable_text_chars` is large** → it's a normal text PDF. Read
  `text.txt` and parse rows with a regex. Still glance at a rendered page to
  confirm the column layout.
- **`extractable_text_chars` is ~0** → it's a **scanned/image/vector** PDF
  (common for credit-card statements). Read the `page{N}.png` files **visually**.
  For small figures (amounts), zoom in:
  ```bash
  # fractions of the page: x0 y0 x1 y1  (e.g. bottom band = 0 0.86 1 1)
  python3 scripts/render_region.py "<STATEMENT.pdf>" 1 0 0.86 1 1 --zoom 4 --out /tmp/stmt/crop.png
  ```
  Then Read `crop.png`. Re-crop until every date/amount is unambiguous —
  **never guess a financial figure.**

### 2. Identify the expense rows
Read the transaction table(s) and keep **only money that was spent**:

- **Bank statement:** keep **withdrawals/debits**. Skip deposits/credits
  (salary, interest, refunds, money received).
- **Credit-card statement:** keep **purchases/debits**. **Exclude the card
  payment** (e.g. "CREDIT CARD PAYMENT", shown as a credit) — that's paying the
  bill, not a spend. Forex markup fees and their GST lines *are* real charges —
  include them (as a "Fees & Charges" category) unless the user says otherwise.

When in doubt about a borderline row (e.g. a self-transfer, an EMI, an
investment debit), include it but flag it to the user afterwards.

### 3. Categorise
Infer a sensible category from the narration/merchant. Useful buckets:
`Food & Dining, Groceries, Shopping, Fuel, Utilities & Bills, Subscriptions,
Health & Medical, Personal Care, Home & Hardware, Investments, Insurance,
Recurring Deposit, Credit Card, Bank Transfer, Fees & Charges, Personal Transfer`.

- For **UPI** rows, the payee name is in the narration (`UPI-<payee>-<vpa>-...`).
  Use it: a bakery/restaurant → Food, a milk/dairy/fish/supermarket → Groceries,
  Groww/Zerodha → Investments, Netflix/Google Play → Subscriptions, fuel agency
  → Fuel, hardware/electricals → Home & Hardware, a clothing brand → Shopping.
- Payments to **individuals** with no business signal → `Personal Transfer`.
- Don't invent precision you can't justify — a generic bucket the user can
  reclassify beats a wrong specific one.

### 4. Build the rows file
Write a CSV with header `Date,Amount,Category,Account,Note` (use the same
**Account** name for every row from one statement, e.g. `HDFC Savings` or
`HDFC Regalia Credit Card`). Then:
```bash
python3 scripts/build_sheet.py /tmp/stmt/rows.csv --out /tmp/stmt/<Bank>-<Month>.xlsx
```
It emits the `.xlsx` + a normalised `.csv` and prints the row count, **grand
total**, and a per-category breakdown.

### 5. Validate (do not skip)
Cross-check the printed **total** against the statement's own figure:
- Bank: reconstruct the running balance (`prev_close − withdrawal + deposit ==
  close` for every row) and/or compare to the period's total debits.
- Credit card: compare to **"Purchases/Debits (current cycle)"**.

If it doesn't reconcile, you misread or mis-classified a row — fix it before
delivering. State the match explicitly (e.g. "totals to ₹13,651.20, matching the
statement").

### 6. Deliver
Send the file with `SendUserFile`, then summarise:
- row count + total, and that it reconciles with the statement;
- the category breakdown;
- the **judgment calls** (what you excluded — e.g. the card payment / deposits —
  and that categories are best-guesses to reclassify after import).

## Notes
- Statements often span two months at a boundary; keep the real transaction
  dates (the Artha importer shards by month automatically).
- Indian formatting: amounts like `1,57,368.46` — strip commas; `Cr`/green/`+`
  usually marks a credit.
- Keep the merchant text in **Note** so the user can re-categorise in-app.
- Never upload or transmit the statement anywhere; all processing is local.
