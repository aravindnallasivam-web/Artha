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
  /** Recorded payments. When present, they drive the outstanding balance
   *  (otherwise it's estimated from the start date). */
  payments: LoanPayment[];
  archived: boolean;
}

/** 'emi' accrues a month's interest; 'prepayment' goes straight to principal. */
export type LoanPaymentType = 'emi' | 'prepayment';

export interface LoanPayment {
  id: string;
  date: string; // 'YYYY-MM-DD'
  amount: number;
  type: LoanPaymentType;
  note: string | null;
}

/** A payment to record (no id yet). */
export interface LoanPaymentInput {
  date: string;
  amount: number;
  type: LoanPaymentType;
  note: string | null;
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
