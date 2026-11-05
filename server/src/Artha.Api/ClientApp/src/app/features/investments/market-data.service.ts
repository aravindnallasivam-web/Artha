import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Quote } from '../../core/models/investment.model';
import { PricePoint } from './price-history';
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
    result?: {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        exchangeName?: string;
        longName?: string;
        currency?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

interface FundDetailResponse {
  meta?: {
    fund_house?: string;
    scheme_type?: string;
    scheme_category?: string;
    scheme_code?: number | string;
    scheme_name?: string;
    isin_growth?: string | null;
    isin_div_reinvestment?: string | null;
  };
  data?: { date?: string; nav?: string }[];
}

export interface FundDetails {
  code: string;
  name: string;
  fundHouse: string | null;
  category: string | null;
  type: string | null;
  isin: string | null;
  /** Daily NAVs, oldest first. */
  history: PricePoint[];
}

export interface StockDetails {
  exchange: string | null;
  name: string | null;
  /** Daily closes for up to 5 years, oldest first. */
  history: PricePoint[];
}

/** dd-mm-yyyy (mfapi) to yyyy-mm-dd. */
const fromDmy = (dmy: string | undefined) => {
  const [d, m, y] = (dmy ?? '').split('-');
  return y && m && d ? `${y}-${m}-${d}` : null;
};

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

  /** Fund schemes whose name matches `query`, for picking the right one by hand. */
  async searchFunds(query: string): Promise<{ code: string; name: string }[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const found = (await this.getFrom(this.fundBase, `/mf/search?q=${encodeURIComponent(q)}`)) as FundSearchResult[] | null;
    return (Array.isArray(found) ? found : [])
      .filter((c) => c.schemeCode && c.schemeName)
      .slice(0, 40)
      .map((c) => ({ code: String(c.schemeCode), name: c.schemeName! }));
  }

  /** Scheme details and full daily NAV history for an "mf:<code>" symbol. */
  async fundDetails(symbol: string): Promise<FundDetails | null> {
    const code = symbol.replace(/^mf:/, '');
    const data = (await this.getFrom(this.fundBase, `/mf/${encodeURIComponent(code)}`)) as FundDetailResponse | null;
    if (!data?.meta) return null;
    const history: PricePoint[] = [];
    for (const row of data.data ?? []) {
      const date = fromDmy(row.date);
      const value = Number(row.nav);
      if (date && Number.isFinite(value) && value > 0) history.push({ date, value });
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    const m = data.meta;
    return {
      code,
      name: m.scheme_name ?? '',
      fundHouse: m.fund_house ?? null,
      category: m.scheme_category ?? null,
      type: m.scheme_type ?? null,
      isin: m.isin_growth || m.isin_div_reinvestment || null,
      history,
    };
  }

  /** Up to 5 years of daily closes for a stock symbol. */
  async stockDetails(symbol: string): Promise<StockDetails | null> {
    const data = (await this.get(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`,
    )) as ChartResponse | null;
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const history: PricePoint[] = [];
    (result.timestamp ?? []).forEach((ts, i) => {
      const value = closes[i];
      if (value == null || !Number.isFinite(value)) return;
      const d = new Date(ts * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      history.push({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, value });
    });
    return { exchange: result.meta?.exchangeName ?? null, name: result.meta?.longName ?? null, history };
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
