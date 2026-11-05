export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  color: string | null;
  icon: string | null;
  archived: boolean;
  /** Bank preset id (e.g. 'hdfc') used for SMS balance sync, or null. */
  bank: string | null;
  /** Credit cards only: credit limit in the account's currency. */
  creditLimit?: number | null;
  /** Credit cards only: last 4 digits printed on the card. */
  cardLast4?: string | null;
  /** Credit cards only: day of the month the statement is generated (1–31). */
  statementDay?: number | null;
  /** Credit cards only: day of the month the bill is due (1–31). */
  dueDay?: number | null;
}

export interface AccountUpsertRequest {
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  color: string | null;
  icon: string | null;
  bank: string | null;
  /** Credit-card fields; leave them out to keep what the account already has. */
  /** Credit cards only: credit limit in the account's currency. */
  creditLimit?: number | null;
  /** Credit cards only: last 4 digits printed on the card. */
  cardLast4?: string | null;
  /** Credit cards only: day of the month the statement is generated (1–31). */
  statementDay?: number | null;
  /** Credit cards only: day of the month the bill is due (1–31). */
  dueDay?: number | null;
}

export const DEFAULT_ACCOUNT_ID = 'acc-cash';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  credit_card: 'Credit Card',
  other: 'Other',
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  checking: 'card-outline',
  savings: 'wallet-outline',
  cash: 'cash-outline',
  credit_card: 'card',
  other: 'ellipsis-horizontal',
};
