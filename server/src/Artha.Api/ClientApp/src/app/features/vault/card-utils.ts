export type CardNetwork = 'visa' | 'mastercard' | 'rupay' | 'amex' | 'diners' | 'discover' | 'jcb' | 'other';

export const NETWORK_LABEL: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'Amex',
  diners: 'Diners Club',
  discover: 'Discover',
  jcb: 'JCB',
  other: 'Card',
};

/** Card network from the number's leading digits (IIN ranges). */
export function detectNetwork(num: string): CardNetwork {
  const n = digits(num);
  if (/^4/.test(n)) return 'visa';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(n)) return 'mastercard';
  if (/^(60|65|81|82|508|353|356)/.test(n)) return 'rupay';
  if (/^(36|38|30[0-5])/.test(n)) return 'diners';
  if (/^(6011|64[4-9])/.test(n)) return 'discover';
  if (/^35(2[89]|[3-8]\d)/.test(n)) return 'jcb';
  return 'other';
}

export function digits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Luhn checksum: catches most typos in a card number. */
export function luhnOk(num: string): boolean {
  const n = digits(num);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** "4111 1111 1111 1111" (Amex 4-6-5). */
export function formatNumber(num: string): string {
  const n = digits(num);
  if (detectNetwork(n) === 'amex') return [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)].filter(Boolean).join(' ');
  return n.replace(/(.{4})/g, '$1 ').trim();
}

export function last4(num: string): string {
  return digits(num).slice(-4);
}

/** "MM/YY" from loose input ("0428", "4/28", "04/2028"). */
export function normalizeExpiry(v: string): string {
  const m = (v ?? '').trim().match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/);
  if (!m) return (v ?? '').trim();
  const mm = Math.min(12, Math.max(1, Number(m[1])));
  return `${String(mm).padStart(2, '0')}/${m[2].slice(-2)}`;
}

/** True when an MM/YY expiry is in the past. */
export function expired(mmYY: string): boolean {
  const m = mmYY.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return false;
  const end = new Date(2000 + Number(m[2]), Number(m[1]), 1); // first day after the expiry month
  return end.getTime() <= Date.now();
}
