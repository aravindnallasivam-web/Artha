/** One point of a price / NAV history, oldest first. */
export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export interface PeriodReturn {
  label: string;
  /** Percent; annualised when `annualised`. Null when the history is too short. */
  pct: number | null;
  annualised: boolean;
}

/** YYYY-MM-DD `months` before the given date. */
export function monthsBefore(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() - months);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The last point on or before `iso` (history is oldest first). */
function pointOnOrBefore(history: PricePoint[], iso: string): PricePoint | null {
  let found: PricePoint | null = null;
  for (const p of history) {
    if (p.date > iso) break;
    found = p;
  }
  return found;
}

/**
 * Point-to-point return over `months`, annualised (CAGR) for 12+ months.
 * Null when the history doesn't reach back that far.
 */
export function periodReturn(history: PricePoint[], months: number): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const start = pointOnOrBefore(history, monthsBefore(last.date, months));
  if (!start || start.value <= 0) return null;
  const growth = last.value / start.value;
  return months >= 12 ? (Math.pow(growth, 12 / months) - 1) * 100 : (growth - 1) * 100;
}

export function standardReturns(history: PricePoint[]): PeriodReturn[] {
  return [
    { label: '1M', months: 1 },
    { label: '6M', months: 6 },
    { label: '1Y', months: 12 },
    { label: '3Y', months: 36 },
    { label: '5Y', months: 60 },
  ].map((p) => ({ label: p.label, pct: periodReturn(history, p.months), annualised: p.months > 12 }));
}

/** Points within the last `months` (all when null), thinned to at most `max` for drawing. */
export function sliceForChart(history: PricePoint[], months: number | null, max = 240): PricePoint[] {
  if (history.length === 0) return [];
  const from = months == null ? '' : monthsBefore(history[history.length - 1].date, months);
  const slice = history.filter((p) => p.date >= from);
  if (slice.length <= max) return slice;
  const step = (slice.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => slice[Math.round(i * step)]);
}
