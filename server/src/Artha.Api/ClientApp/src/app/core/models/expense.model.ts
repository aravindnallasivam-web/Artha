/** A transaction is money out ('expense') or money in ('income'). */
export type TransactionType = 'expense' | 'income';

/** Where the phone was when the expense SMS arrived (saved by the full-screen alert). */
export interface ExpenseLocation {
  lat: number;
  lng: number;
  /** Accuracy radius in metres, when known. */
  accuracy?: number | null;
  /** ISO time of the fix. */
  at: string;
}

export interface Expense {
  id: string;
  date: string; // ISO date 'YYYY-MM-DD'
  amount: number;
  currency: string;
  categoryId: string;
  accountId: string;
  note: string | null;
  excluded: boolean; // true => not counted in spending totals/counts
  /** 'expense' (money out, default) or 'income' (money in). */
  type: TransactionType;
  /** Optional; only SMS expenses captured with location on have it. */
  location?: ExpenseLocation | null;
  /** What it was for, in your words ("Amma's birthday cake"). The note holds the shop / payee. */
  description?: string | null;
  /** Your labels ("birthday", "family", "goa-trip"): lower-case, no spaces. */
  tags?: string[];
  /** The event (trip, celebration…) this expense belongs to. */
  eventId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCreateRequest {
  date: string;
  amount: number;
  categoryId: string;
  accountId: string;
  note: string | null;
  excluded: boolean;
  /** Defaults to 'expense' when omitted. */
  type?: TransactionType;
  /** Omitted = keep the current one on update; null = clear it. */
  location?: ExpenseLocation | null;
  /** Omitted = keep on update; null / '' = clear. */
  description?: string | null;
  /** Omitted = keep on update; [] = clear. */
  tags?: string[];
  /** Omitted = on create, the event covering the date (if any); on update, keep. null = none. */
  eventId?: string | null;
}

export interface ExpenseUpdateRequest extends ExpenseCreateRequest {}

export interface ExpenseListResponse {
  items: Expense[];
  currency: string;
}
