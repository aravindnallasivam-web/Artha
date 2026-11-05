import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Quote } from '../../core/models/investment.model';
import { environment } from '../../../environments/environment';

interface SearchResponse {
  quotes?: { symbol?: string; quoteType?: string; exchange?: string }[];
}

interface ChartResponse {
  chart?: {
    result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[];
  };
}

/**
 * Indian stock prices from Yahoo Finance (free, no key, ~15 min delayed).
 * Native HTTP on the device; the Docker web build goes through its nginx proxy.
 */
@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private readonly base = environment.marketDataBase;

  /** NSE symbol (e.g. "RELIANCE.NS") for an ISIN or company name, BSE if not on NSE. */
  async resolveSymbol(query: string): Promise<string | null> {
    const data = (await this.get(
      `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0&listsCount=0`,
    )) as SearchResponse | null;
    const equities = (data?.quotes ?? []).filter((q) => q.symbol && (!q.quoteType || q.quoteType === 'EQUITY'));
    const pick =
      equities.find((q) => q.symbol!.endsWith('.NS')) ??
      equities.find((q) => q.symbol!.endsWith('.BO')) ??
      null;
    return pick?.symbol ?? null;
  }

  async quote(symbol: string): Promise<Quote | null> {
    const data = (await this.get(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    )) as ChartResponse | null;
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice == null) return null;
    return {
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async get(path: string): Promise<unknown> {
    try {
      const res = await CapacitorHttp.request({
        method: 'GET',
        url: `${this.base}${path}`,
        headers: Capacitor.isNativePlatform() ? { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } : {},
        connectTimeout: 10_000,
        readTimeout: 15_000,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } catch {
      return null;
    }
  }
}
