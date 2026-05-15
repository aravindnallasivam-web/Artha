export interface Expense {
  id: string;
  date: string; // ISO date 'YYYY-MM-DD'
  amount: number;
  currency: string;
  categoryId: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCreateRequest {
  date: string;
  amount: number;
  categoryId: string;
  note: string | null;
}

export interface ExpenseUpdateRequest extends ExpenseCreateRequest {}

export interface ExpenseListResponse {
  items: Expense[];
  currency: string;
}
