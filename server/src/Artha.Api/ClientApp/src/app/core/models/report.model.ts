export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  total: number;
  count: number;
}

export interface MonthlyReport {
  year: number;
  month: number;
  currency: string;
  total: number;
  count: number;
  byCategory: CategoryBreakdown[];
}

export interface MonthSummary {
  month: number;
  total: number;
  count: number;
}

export interface YearlyReport {
  year: number;
  currency: string;
  yearTotal: number;
  yearCount: number;
  months: MonthSummary[];
  byCategory: CategoryBreakdown[];
}

export const MONTH_LABELS: ReadonlyArray<string> = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
