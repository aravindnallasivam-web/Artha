export interface Settings {
  currency: string;
  firstRunCompleted: boolean;
  locale: string | null;
}

export interface SettingsUpdateRequest {
  currency: string;
}

export const SUPPORTED_CURRENCIES: ReadonlyArray<{ code: string; symbol: string; label: string }> = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee (₹)' },
  { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen (¥)' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar (A$)' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar (C$)' },
];

export function symbolFor(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}
