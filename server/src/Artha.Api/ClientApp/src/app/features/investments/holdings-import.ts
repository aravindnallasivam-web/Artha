import { Holding } from '../../core/models/investment.model';

/** A spreadsheet cell as read from .xlsx / .csv. */
export type Cell = string | number | boolean | Date | null | undefined;

export interface HoldingsImportResult {
  holdings: Omit<Holding, 'id' | 'symbol'>[];
  /** Rows that looked like holdings but couldn't be read. */
  skipped: number;
}

type Column = 'name' | 'isin' | 'quantity' | 'avgPrice' | 'statementPrice';

// Header text → column, checked in order (first match wins per header cell).
// Broker exports differ in wording, so match loosely on normalised text.
const HEADER_RULES: { column: Column; test: RegExp }[] = [
  { column: 'isin', test: /^isin/ },
  { column: 'avgPrice', test: /^(avg|average)(buy)?(price|cost|rate)|^buyavg|^avgprice|^averageprice/ },
  { column: 'statementPrice', test: /^(closing|close|current|market|last|ltp)(price|rate)?$|^ltp/ },
  { column: 'quantity', test: /^(quantity|qty|shares|units|holdingqty|freeqty)/ },
  { column: 'name', test: /^(stockname|companyname|company|security(name)?|instrument|scrip(name)?|symbol|name|stock)$/ },
];

const normalise = (v: Cell) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Map header cells to columns; null when this row isn't a holdings header. */
function headerMap(row: Cell[]): Partial<Record<Column, number>> | null {
  const map: Partial<Record<Column, number>> = {};
  row.forEach((cell, idx) => {
    const text = normalise(cell);
    if (!text) return;
    const rule = HEADER_RULES.find((r) => r.test.test(text));
    if (rule && map[rule.column] === undefined) map[rule.column] = idx;
  });
  const ok = map.name !== undefined && map.quantity !== undefined && map.avgPrice !== undefined;
  return ok ? map : null;
}

/**
 * Read holdings from the rows of a broker holdings statement. The header row is
 * found anywhere in the sheet (statements usually start with account details
 * and a summary), and the table ends at the first blank or totals row.
 * Returns null when no holdings table is found.
 */
export function parseHoldingsRows(rows: Cell[][]): HoldingsImportResult | null {
  const headerIdx = rows.findIndex((r) => headerMap(r) !== null);
  if (headerIdx < 0) return null;
  const cols = headerMap(rows[headerIdx])!;
  const at = (row: Cell[], c: Column) => (cols[c] === undefined ? undefined : row[cols[c]!]);

  const holdings: HoldingsImportResult['holdings'] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    const name = String(at(row, 'name') ?? '').trim();
    if (!name) {
      if (holdings.length > 0) break;
      continue;
    }
    if (/^(total|grand total|net)\b/i.test(name)) break;
    const quantity = toNumber(at(row, 'quantity'));
    const avgPrice = toNumber(at(row, 'avgPrice'));
    if (quantity == null || avgPrice == null || quantity <= 0) {
      skipped++;
      continue;
    }
    const isin = String(at(row, 'isin') ?? '').trim().toUpperCase();
    holdings.push({
      name,
      isin: /^IN[A-Z0-9]{10}$/.test(isin) ? isin : null,
      quantity,
      avgPrice,
      statementPrice: toNumber(at(row, 'statementPrice')),
    });
  }
  return { holdings, skipped };
}

/** Minimal CSV reader (quoted fields, commas, CRLF) for holdings exported as .csv. */
export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
