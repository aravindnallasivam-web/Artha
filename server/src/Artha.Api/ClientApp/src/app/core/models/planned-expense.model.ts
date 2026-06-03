export type PlannedFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  frequency: PlannedFrequency;
  categoryId: string | null;
  dayOfMonth: number | null;
  archived: boolean;
}

export interface PlannedExpenseUpsertRequest {
  name: string;
  amount: number;
  frequency: PlannedFrequency;
  categoryId: string | null;
  dayOfMonth: number | null;
}

export const PLANNED_FREQUENCIES: PlannedFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export const PLANNED_FREQUENCY_LABELS: Record<PlannedFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** Short suffix for displaying an amount with its cadence, e.g. "1,200/yr". */
export const PLANNED_FREQUENCY_SUFFIX: Record<PlannedFrequency, string> = {
  weekly: '/wk',
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
};

/** Convert an amount to its per-month equivalent for budget totals. */
export function monthlyEquivalent(amount: number, frequency: PlannedFrequency): number {
  switch (frequency) {
    case 'weekly':
      return (amount * 52) / 12;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
    default:
      return amount;
  }
}
