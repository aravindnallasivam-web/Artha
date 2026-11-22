/**
 * A trip, a celebration, a project with dates: expenses inside its dates join
 * it automatically, so it shows its own total, budget and split.
 */
export interface AppEvent {
  id: string;
  name: string;
  /** One emoji shown with the name ("🏖️"). */
  emoji: string | null;
  /** First day, 'YYYY-MM-DD'. */
  start: string;
  /** Last day, 'YYYY-MM-DD' (inclusive). */
  end: string;
  /** Planned spend; null = no budget. */
  budget: number | null;
  /** People sharing the cost (for "per person"); 1 = just you. */
  people: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppEventUpsert {
  name: string;
  emoji: string | null;
  start: string;
  end: string;
  budget: number | null;
  people: number;
}

/** True when `date` ('YYYY-MM-DD') is inside the event's days. */
export function eventCovers(e: AppEvent, date: string): boolean {
  return !e.archived && date >= e.start && date <= e.end;
}
