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
}

export interface AccountUpsertRequest {
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  color: string | null;
  icon: string | null;
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
