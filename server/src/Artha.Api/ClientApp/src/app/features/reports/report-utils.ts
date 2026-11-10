import { Expense } from '../../core/models/expense.model';

/** Whether a transaction counts toward spending totals (not income, not excluded). */
export function countsAsSpend(e: Expense): boolean {
  return !e.excluded && e.type !== 'income';
}

/** Derive a readable merchant/payee from a transaction note. */
export function merchantOf(note: string | null): string {
  const n = (note ?? '').trim();
  if (!n) return 'Unknown';
  if (/^UPI-/i.test(n)) {
    const parts = n.split('-');
    return (parts[1] || n).trim().slice(0, 28);
  }
  // Strip trailing reference numbers / "Value Dt ..." tails.
  const cleaned = n.replace(/\s+(value dt|ref).*$/i, '').replace(/\s+\d{6,}.*$/, '');
  return (cleaned || n).slice(0, 28).trim();
}

/** "₹7.2K", "₹1.1L"-free compact money for chips and chart labels (Indian grouping off). */
export function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
    }).format(value);
  } catch {
    return Math.round(value).toLocaleString();
  }
}

export function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
