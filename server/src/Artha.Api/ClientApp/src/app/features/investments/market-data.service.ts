import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Quote } from '../../core/models/investment.model';
import { environment } from '../../../environments/environment';

interface SearchResponse {
  quotes?: { symbol?: string; quoteType?: string; exchange?: string }[];
}

interface FundSearchResult {
  schemeCode?: number | string;
  schemeName?: string;
}

interface FundLatestResponse {
  data?: { date?: string; nav?: string }[];
}

// Words that describe the plan/option rather than the fund itself.
const FUND_NOISE = /\b(fund|plan|option|direct|regular|growth|idcw|dividend|payout|reinvestment|reinvest|the|of|and)\b/g;

const fundWords = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(FUND_NOISE, ' ').split(/\s+/).filter(Boolean);

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
  private readonly fundBase = environment.fundDataBase;

  /**
   * AMFI scheme code for a mutual fund named on a statement, as "mf:<code>".
   * Picks the closest scheme name with the same plan (Direct/Regular) and
   * option (Growth/IDCW) as the statement's name.
   */
  async resolveFund(name: string): Promise<string | null> {
    const words = fundWords(name);
    if (words.length === 0) return null;
    const lower = name.toLowerCase();
    const wantDirect = /\bdirect\b/.test(lower);
    const wantIdcw = /\b(idcw|dividend|payout)\b/.test(lower);
    for (const query of [words.join(' '), words.slice(0, 3).join(' ')]) {
      const found = (await this.getFrom(this.fundBase, `/mf/search?q=${encodeURIComponent(query)}`)) as
        | FundSearchResult[]
        | null;
      const candidates = (Array.isArray(found) ? found : []).filter((c) => c.schemeCode && c.schemeName);
      let best: { code: string; score: number } | null = null;
      for (const c of candidates) {
        const cname = c.schemeName!.toLowerCase();
        const cwords = new Set(fundWords(cname));
        let score = words.filter((w) => cwords.has(w)).length * 10 - Math.max(0, cwords.size - words.length);
        if (/\bdirect\b/.test(cname) === wantDirect) score += 25;
        if (/\b(idcw|dividend|payout)\b/.test(cname) === wantIdcw) score += 15;
        if (/\b(bonus|segregated)\b/.test(cname)) score -= 30;
        if (!best || score > best.score) best = { code: String(c.schemeCode), score };
      }
      if (best && best.score >= words.length * 10) return `mf:${best.code}`;
    }
    return null;
  }

  /** Latest NAV for an "mf:<code>" symbol. */
  async fundQuote(symbol: string): Promise<Quote | null> {
    const code = symbol.replace(/^mf:/, '');
    const data = (await this.getFrom(this.fundBase, `/mf/${encodeURIComponent(code)}/latest`)) as FundLatestResponse | null;
    const latest = data?.data?.[0];
    const nav = latest?.nav != null ? Number(latest.nav) : NaN;
    if (!Number.isFinite(nav) || nav <= 0) return null;
    const [dd, mm, yyyy] = (latest!.date ?? '').split('-');
    return {
      price: nav,
      previousClose: null,
      asOf: yyyy && mm && dd ? `${yyyy}-${mm}-${dd}` : null,
      fetchedAt: new Date().toISOString(),
    };
  }

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

  private get(path: string): Promise<unknown> {
    return this.getFrom(this.base, path);
  }

  private async getFrom(base: string, path: string): Promise<unknown> {
    try {
      const res = await CapacitorHttp.request({
        method: 'GET',
        url: `${base}${path}`,
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
