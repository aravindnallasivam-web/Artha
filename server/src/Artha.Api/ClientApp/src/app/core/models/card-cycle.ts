import { Account } from './account.model';

/** A date in the given month with `day` clamped to that month's length. */
function dayInMonth(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The most recent statement date on or before today. */
export function lastStatementDate(statementDay: number, today = new Date()): Date {
  const t = startOfDay(today);
  const thisMonth = dayInMonth(t.getFullYear(), t.getMonth(), statementDay);
  return thisMonth <= t ? thisMonth : dayInMonth(t.getFullYear(), t.getMonth() - 1, statementDay);
}

/** The next due date on or after today. */
export function nextDueDate(dueDay: number, today = new Date()): Date {
  const t = startOfDay(today);
  const thisMonth = dayInMonth(t.getFullYear(), t.getMonth(), dueDay);
  return thisMonth >= t ? thisMonth : dayInMonth(t.getFullYear(), t.getMonth() + 1, dueDay);
}

/** Whole days from today until `date` (0 = today). */
export function daysUntil(date: Date, today = new Date()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000);
}

/** "today", "tomorrow" or "in 5 days". */
export function dueLabel(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * What the card currently owes. A card's balance is entered or synced as the
 * outstanding amount; either sign is accepted.
 */
export function cardOwed(acc: Account): number {
  return Math.abs(acc.openingBalance);
}
