// DTOs for the Excel/CSV expense import flow. These mirror the shapes returned
// by POST /api/expenses/import/preview and POST /api/expenses/import.

export interface ImportPreviewRow {
  rowNumber: number;
  date: string | null;       // ISO 'YYYY-MM-DD' once parsed, null if unparseable
  amount: number | null;
  category: string | null;
  account: string | null;
  note: string | null;
  valid: boolean;
  errors: string[];
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
  validCount: number;
  invalidCount: number;
  newCategories: string[];
  newAccounts: string[];
  currency: string;
}

export interface ImportConfirmRow {
  date: string;              // ISO 'YYYY-MM-DD'
  amount: number;
  category: string;
  account: string | null;
  note: string | null;
}

export interface ImportConfirmRequest {
  rows: ImportConfirmRow[];
}

export interface ImportResultResponse {
  importedCount: number;
  createdCategories: string[];
  createdAccounts: string[];
}
