export interface Expense {
  id: string;
  date: string; // ISO date 'YYYY-MM-DD'
  amount: number;
  currency: string;
  categoryId: string;
  accountId: string;
  note: string | null;
  excluded: boolean; // true => not counted in spending totals/counts
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
}

export interface ExpenseUpdateRequest extends ExpenseCreateRequest {}

export interface ExpenseListResponse {
  items: Expense[];
  currency: string;
}
