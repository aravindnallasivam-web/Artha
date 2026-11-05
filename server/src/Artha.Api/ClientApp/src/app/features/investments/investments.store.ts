import { Injectable, computed, inject, signal } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { DRIVE_FILES, SCHEMA_VERSION, SchemaVersioned, newId } from '../../core/drive/drive-schema';
import { Holding, HoldingKind, InvestmentsSnapshot, Quote } from '../../core/models/investment.model';
import { Cell, HoldingsImportResult, parseCsv, parseFundRows, parseHoldingsRows } from './holdings-import';
import { MarketDataService } from './market-data.service';

interface InvestmentsDoc extends SchemaVersioned, InvestmentsSnapshot {}

export type PriceSource = 'live' | 'statement' | 'none';

export interface HoldingRow {
  holding: Holding;
  kind: HoldingKind;
  /** Date of the price used (fund NAVs), when known. */
  asOf: string | null;
  price: number | null;
  source: PriceSource;
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number | null;
  /** Today's change in value; null without a live quote. */
  dayChange: number | null;
}

// Last fetched quotes, so the screen has numbers before the refresh finishes.
const QUOTES_KEY = 'artha.investments.quotes';
const CONCURRENCY = 4;

@Injectable({ providedIn: 'root' })
export class InvestmentsStore {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);
  private readonly market = inject(MarketDataService);

  private readonly _snapshot = signal<InvestmentsSnapshot>({ items: [], importedAt: null, source: null });
  private readonly _quotes = signal<Record<string, Quote>>(loadQuotes());
  readonly snapshot = this._snapshot.asReadonly();
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loaded = signal(false);

  readonly rows = computed<HoldingRow[]>(() =>
    this._snapshot().items.map((h) => {
      const quote = h.symbol ? this._quotes()[h.symbol] : undefined;
      const price = quote?.price ?? h.statementPrice ?? null;
      const source: PriceSource = quote ? 'live' : h.statementPrice != null ? 'statement' : 'none';
      const invested = h.quantity * h.avgPrice;
      const value = price != null ? h.quantity * price : invested;
      const pnl = value - invested;
      return {
        holding: h,
        kind: h.kind ?? 'stock',
        asOf: quote?.asOf ?? null,
        price,
        source,
        invested,
        value,
        pnl,
        pnlPct: invested > 0 && price != null ? (pnl / invested) * 100 : null,
        dayChange: quote?.previousClose != null ? h.quantity * (quote.price - quote.previousClose) : null,
      };
    }),
  );

  readonly totals = computed(() => {
    const rows = this.rows();
    const invested = rows.reduce((s, r) => s + r.invested, 0);
    const value = rows.reduce((s, r) => s + r.value, 0);
    const withDay = rows.filter((r) => r.dayChange != null);
    const dayChange = withDay.length ? withDay.reduce((s, r) => s + r.dayChange!, 0) : null;
    // Today's % is relative to the holdings that have a day change (stocks), not funds too.
    const prevValue = dayChange != null ? withDay.reduce((s, r) => s + r.value, 0) - dayChange : null;
    return {
      invested,
      value,
      pnl: value - invested,
      pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      dayChange,
      dayChangePct: dayChange != null && prevValue ? (dayChange / prevValue) * 100 : null,
      liveCount: rows.filter((r) => r.source === 'live').length,
      count: rows.length,
    };
  });

  /** When the newest live quote was fetched. */
  readonly pricesAt = computed(() => {
    const times = Object.values(this._quotes()).map((q) => q.fetchedAt).sort();
    return times.length ? times[times.length - 1] : null;
  });

  async load(force = false): Promise<void> {
    if (this.loaded() && !force) return;
    this.loading.set(true);
    try {
      await this.bootstrap.ensureInitialized();
      const doc = await this.repo.read<InvestmentsDoc>(DRIVE_FILES.investments);
      if (doc) {
        const { items, importedAt, source } = doc.document;
        this._snapshot.set({ items: items ?? [], importedAt: importedAt ?? null, source: source ?? null });
      }
      this.loaded.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Replace holdings with those in a broker holdings statement (.xlsx or .csv).
   * Returns how many were imported; throws a readable error if none were found.
   */
  /**
   * Import a broker holdings statement (.xlsx or .csv) of stocks, mutual funds,
   * or both. Only the kinds found in the file are replaced, so importing a funds
   * report keeps the stocks and vice versa. Throws a readable error if the file
   * has neither table.
   */
  async importFile(file: File): Promise<{ stocks: number; funds: number; skipped: number }> {
    const sheets = await readSheets(file);
    const firstWith = (parse: (rows: Cell[][]) => HoldingsImportResult | null) =>
      sheets.map((rows) => parse(rows)).find((r) => r && r.holdings.length > 0) ?? null;
    const found: [HoldingKind, HoldingsImportResult | null][] = [
      ['stock', firstWith(parseHoldingsRows)],
      ['mf', firstWith(parseFundRows)],
    ];
    const imported = found.filter((f): f is [HoldingKind, HoldingsImportResult] => f[1] !== null);
    if (imported.length === 0) {
      throw new Error(
        "Couldn't find a holdings table in that file. Use the stocks or mutual funds holdings report exported " +
          'from your broker (it needs columns like Stock / Scheme name, Quantity / Units and Average price / Invested value).',
      );
    }
    // Keep symbols already found for the same holding, so they aren't looked up again.
    const keyOf = (kind: HoldingKind, h: { isin: string | null; name: string }) => `${kind}|${h.isin ?? h.name.toLowerCase()}`;
    const known = new Map<string, string>();
    for (const h of this._snapshot().items) {
      if (h.symbol) known.set(keyOf(h.kind ?? 'stock', h), h.symbol);
    }
    const replacedKinds = new Set(imported.map(([kind]) => kind));
    const kept = this._snapshot().items.filter((h) => !replacedKinds.has(h.kind ?? 'stock'));
    const fresh: Holding[] = imported.flatMap(([kind, result]) =>
      result.holdings.map((h) => ({ ...h, kind, id: newId('hold'), symbol: known.get(keyOf(kind, h)) ?? null })),
    );
    await this.save({ items: [...kept, ...fresh], importedAt: new Date().toISOString(), source: file.name });
    void this.refreshPrices();
    const count = (kind: HoldingKind) => fresh.filter((h) => h.kind === kind).length;
    return {
      stocks: count('stock'),
      funds: count('mf'),
      skipped: imported.reduce((n, [, r]) => n + r.skipped, 0),
    };
  }

  /** Point a holding at a different symbol / fund scheme (when the automatic match was wrong). */
  async setSymbol(id: string, symbol: string): Promise<void> {
    const items = this._snapshot().items.map((h) => (h.id === id ? { ...h, symbol } : h));
    await this.save({ ...this._snapshot(), items });
    const q = symbol.startsWith('mf:') ? await this.market.fundQuote(symbol) : await this.market.quote(symbol);
    if (q) {
      const quotes = { ...this._quotes(), [symbol]: q };
      this._quotes.set(quotes);
      try {
        localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
      } catch {
        // Cache only.
      }
    }
  }

  async clear(): Promise<void> {
    await this.save({ items: [], importedAt: null, source: null });
  }

  /** Look up missing symbols, then fetch a quote for every holding. */
  async refreshPrices(): Promise<void> {
    if (this.refreshing() || this._snapshot().items.length === 0) return;
    this.refreshing.set(true);
    try {
      const items = [...this._snapshot().items];
      let symbolsChanged = false;
      await runPool(items, async (h, i) => {
        if (h.symbol) return;
        const symbol =
          h.kind === 'mf'
            ? await this.market.resolveFund(h.name)
            : (h.isin ? await this.market.resolveSymbol(h.isin) : null) ?? (await this.market.resolveSymbol(h.name));
        if (symbol) {
          items[i] = { ...h, symbol };
          symbolsChanged = true;
        }
      });
      if (symbolsChanged) {
        await this.save({ ...this._snapshot(), items });
      }

      const symbols = [...new Set(items.map((h) => h.symbol).filter((s): s is string => !!s))];
      const quotes: Record<string, Quote> = { ...this._quotes() };
      await runPool(symbols, async (symbol) => {
        const q = symbol.startsWith('mf:') ? await this.market.fundQuote(symbol) : await this.market.quote(symbol);
        if (q) quotes[symbol] = q;
      });
      this._quotes.set(quotes);
      try {
        localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
      } catch {
        // Cache is a convenience; the next refresh refills it.
      }
    } finally {
      this.refreshing.set(false);
    }
  }

  private async save(snapshot: InvestmentsSnapshot): Promise<void> {
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<InvestmentsDoc>(DRIVE_FILES.investments);
    await this.repo.write<InvestmentsDoc>(
      DRIVE_FILES.investments,
      { schemaVersion: SCHEMA_VERSION, ...snapshot },
      existing?.etag,
    );
    this._snapshot.set(snapshot);
    this.loaded.set(true);
  }
}

/** Every sheet's rows: .csv as one sheet, .xlsx via read-excel-file (loaded on demand). */
async function readSheets(file: File): Promise<Cell[][][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    return [parseCsv(await file.text())];
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('Old .xls files aren\'t supported. Re-export the report as .xlsx (Excel) or .csv.');
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  try {
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => s.data as Cell[][]);
  } catch {
    throw new Error("That file couldn't be read as an Excel (.xlsx) file.");
  }
}

async function runPool<T>(items: T[], task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

function loadQuotes(): Record<string, Quote> {
  try {
    return JSON.parse(localStorage.getItem(QUOTES_KEY) ?? '{}') as Record<string, Quote>;
  } catch {
    return {};
  }
}
