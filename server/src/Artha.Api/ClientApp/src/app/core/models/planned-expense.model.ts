/** Legacy billing cycle (pre-interval). Kept so old data still reads. */
export type PlannedCycle = 'monthly' | 'yearly';

export interface PlannedExpense {
  id: string;
  name: string;
  /** Amount charged each occurrence. */
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
  archived: boolean;
  /** Months between occurrences: 1 = monthly, 12 = yearly, 4 = every 4 months. */
  intervalMonths: number;
  /** @deprecated superseded by intervalMonths; still read for old records. */
  cycle?: PlannedCycle;
}

export interface PlannedExpenseUpsertRequest {
  name: string;
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
  /** Months between occurrences (1 = monthly, 12 = yearly). */
  intervalMonths: number;
}

/** Months between occurrences, falling back to the legacy cycle for old records. */
export function intervalOf(p: { intervalMonths?: number | null; cycle?: PlannedCycle | null }): number {
  if (p.intervalMonths && p.intervalMonths > 0) {
    return Math.round(p.intervalMonths);
  }
  return p.cycle === 'yearly' ? 12 : 1;
}

/** Monthly-equivalent of a planned expense (its amount spread over the interval). */
export function monthlyEquivalent(p: {
  amount: number;
  intervalMonths?: number | null;
  cycle?: PlannedCycle | null;
}): number {
  return p.amount / intervalOf(p);
}

/** Human cadence label, e.g. "Monthly", "Yearly", "Every 4 months". */
export function cadenceLabel(p: { intervalMonths?: number | null; cycle?: PlannedCycle | null }): string {
  const n = intervalOf(p);
  if (n === 1) return 'Monthly';
  if (n === 12) return 'Yearly';
  return `Every ${n} months`;
}
