/** A loan you've taken (debt you owe), tracked with full amortization. */
export interface Loan {
  id: string;
  name: string;
  lender: string | null;
  /** Original amount borrowed. */
  principal: number;
  /** Nominal annual interest rate, percent (e.g. 8.5). */
  annualInterestRate: number;
  /** Tenure in months. */
  termMonths: number;
  /** Date of the first EMI ('YYYY-MM-DD'). */
  startDate: string;
  /** Account the EMI is paid from, or null. */
  accountId: string | null;
  archived: boolean;
}

export interface LoanUpsertRequest {
  name: string;
  lender: string | null;
  principal: number;
  annualInterestRate: number;
  termMonths: number;
  startDate: string;
  accountId: string | null;
}
