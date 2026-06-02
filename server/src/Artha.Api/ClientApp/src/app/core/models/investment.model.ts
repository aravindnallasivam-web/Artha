export type InvestmentType =
  | 'recurring_deposit'
  | 'fixed_deposit'
  | 'insurance_policy'
  | 'mutual_fund';

export interface Investment {
  id: string;
  name: string;
  type: InvestmentType;
  currency: string;
  investedAmount: number;
  currentValue: number;
  interestRate: number | null;
  installmentAmount: number | null;
  startDate: string | null;
  maturityDate: string | null;
  institution: string | null;
  policyOrAccountNumber: string | null;
  note: string | null;
  color: string | null;
  icon: string | null;
  archived: boolean;
}

export interface InvestmentUpsertRequest {
  name: string;
  type: InvestmentType;
  currency: string;
  investedAmount: number;
  currentValue: number;
  interestRate: number | null;
  installmentAmount: number | null;
  startDate: string | null;
  maturityDate: string | null;
  institution: string | null;
  policyOrAccountNumber: string | null;
  note: string | null;
  color: string | null;
  icon: string | null;
}

// RD is listed first — it's the primary type users reach for.
export const INVESTMENT_TYPE_OPTIONS: InvestmentType[] = [
  'recurring_deposit',
  'fixed_deposit',
  'mutual_fund',
  'insurance_policy',
];

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  recurring_deposit: 'Recurring Deposit',
  fixed_deposit: 'Fixed Deposit',
  mutual_fund: 'Mutual Fund',
  insurance_policy: 'Insurance Policy',
};

export const INVESTMENT_TYPE_ICONS: Record<InvestmentType, string> = {
  recurring_deposit: 'repeat-outline',
  fixed_deposit: 'lock-closed-outline',
  mutual_fund: 'pie-chart-outline',
  insurance_policy: 'umbrella',
};
