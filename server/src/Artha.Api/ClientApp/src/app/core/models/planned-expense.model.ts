/** Billing cycle for a planned expense. */
export type PlannedCycle = 'monthly' | 'yearly';

export interface PlannedExpense {
  id: string;
  name: string;
  /** Amount per billing cycle. */
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
  archived: boolean;
  cycle: PlannedCycle;
}

export interface PlannedExpenseUpsertRequest {
  name: string;
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
  cycle: PlannedCycle;
}

/** Monthly-equivalent of a planned expense (yearly amounts are spread over 12). */
export function monthlyEquivalent(p: { amount: number; cycle: PlannedCycle }): number {
  return p.cycle === 'yearly' ? p.amount / 12 : p.amount;
}
