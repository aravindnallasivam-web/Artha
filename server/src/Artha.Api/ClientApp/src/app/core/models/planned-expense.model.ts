export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
  archived: boolean;
}

export interface PlannedExpenseUpsertRequest {
  name: string;
  amount: number;
  categoryId: string | null;
  dayOfMonth: number | null;
}
