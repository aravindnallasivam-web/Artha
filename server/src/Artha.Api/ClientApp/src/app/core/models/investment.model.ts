/** One stock holding, as imported from a broker's holdings statement. */
export interface Holding {
  id: string;
  name: string;
  /** ISIN from the statement; used to look up the market symbol. */
  isin: string | null;
  /** Market-data symbol (e.g. "RELIANCE.NS"); null until resolved. */
  symbol: string | null;
  quantity: number;
  /** Average buy price per share. */
  avgPrice: number;
  /** Closing price printed on the statement, used when no live price is available. */
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
  /** ISO timestamp the quote was fetched. */
  fetchedAt: string;
}
