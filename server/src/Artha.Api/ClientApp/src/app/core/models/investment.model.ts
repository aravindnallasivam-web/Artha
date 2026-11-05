export type HoldingKind = 'stock' | 'mf';

/** One stock or mutual fund holding, as imported from a broker's holdings statement. */
export interface Holding {
  id: string;
  /** Missing on holdings saved before mutual funds existed; treat as 'stock'. */
  kind?: HoldingKind;
  /** Broker / app the holding is held on (e.g. "Groww"); missing on holdings imported before platforms existed. */
  platform?: string;
  name: string;
  /** ISIN from the statement; used to look up the market symbol. */
  isin: string | null;
  /** Price lookup key: a market symbol ("RELIANCE.NS") or "mf:<AMFI scheme code>"; null until resolved. */
  symbol: string | null;
  /** Shares, or units for a mutual fund. */
  quantity: number;
  /** Average buy price per share / average NAV per unit. */
  avgPrice: number;
  /** Closing price / NAV implied by the statement, used when no live price is available. */
  statementPrice: number | null;
}

export interface InvestmentsSnapshot {
  items: Holding[];
  /** ISO timestamp of the last import. */
  importedAt: string | null;
  /** File name the holdings came from. */
  source: string | null;
}

/** A live quote for a symbol. */
export interface Quote {
  price: number;
  previousClose: number | null;
  /** Date the price applies to (mutual fund NAVs are daily), e.g. "2026-11-04". */
  asOf?: string | null;
  /** ISO timestamp the quote was fetched. */
  fetchedAt: string;
}
