import { AppEvent } from '../../core/models/event.model';
import { Expense } from '../../core/models/expense.model';

export interface EventStats {
  /** Money spent in the event (not income, not excluded). */
  spent: number;
  count: number;
  days: number;
  /** Days of the event so far (all of them once it's over). */
  daysSoFar: number;
  perDay: number;
  perPerson: number;
  /** spent / budget (0..∞), null without a budget. */
  used: number | null;
  status: 'upcoming' | 'ongoing' | 'ended';
  /** Days until it starts (upcoming) or left including today (ongoing). */
  daysAway: number;
}

const DAY = 24 * 60 * 60 * 1000;

function dayNum(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function eventStats(e: AppEvent, expenses: Expense[], today: string): EventStats {
  const mine = expenses.filter((x) => x.eventId === e.id);
  const spent = mine.filter((x) => !x.excluded && x.type !== 'income').reduce((s, x) => s + x.amount, 0);
  const days = dayNum(e.end) - dayNum(e.start) + 1;
  const t = dayNum(today);
  const status = t < dayNum(e.start) ? 'upcoming' : t > dayNum(e.end) ? 'ended' : 'ongoing';
  const daysSoFar = status === 'upcoming' ? 0 : status === 'ended' ? days : t - dayNum(e.start) + 1;
  return {
    spent,
    count: mine.length,
    days,
    daysSoFar,
    perDay: spent / Math.max(1, daysSoFar || days),
    perPerson: spent / Math.max(1, e.people),
    used: e.budget ? spent / e.budget : null,
    status,
    daysAway: status === 'upcoming' ? dayNum(e.start) - t : status === 'ongoing' ? dayNum(e.end) - t + 1 : 0,
  };
}

export function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function rangeLabel(e: AppEvent): string {
  return e.start === e.end ? dateLabel(e.start) : `${dateLabel(e.start)} – ${dateLabel(e.end)}`;
}

export function statusLabel(s: EventStats): string {
  if (s.status === 'upcoming') return s.daysAway === 1 ? 'Starts tomorrow' : `Starts in ${s.daysAway} days`;
  if (s.status === 'ongoing') return `Day ${s.daysSoFar} of ${s.days}`;
  return 'Ended';
}
