/** A transaction is money out ('expense') or money in ('income'). */
export type TransactionType = 'expense' | 'income';

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
}

export interface ExpenseUpdateRequest extends ExpenseCreateRequest {}

export interface ExpenseListResponse {
  items: Expense[];
  currency: string;
}
