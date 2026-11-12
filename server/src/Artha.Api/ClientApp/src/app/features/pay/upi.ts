/** A UPI payment code read from a QR ("upi://pay?pa=shop@ybl&pn=Shop&am=120&mc=5411"). */
export interface UpiQr {
  /** Payee UPI id. */
  pa: string;
  /** Payee name as the QR gives it. */
  pn: string;
  /** Amount fixed by the QR (dynamic / bill QR), or null when you enter it. */
  am: number | null;
  /** Merchant category code: present (and not 0000) on merchant QRs. */
  mc: string | null;
  /** Note set by the QR. */
  tn: string | null;
  /** True when the QR is signed by the merchant's bank: its fields must not change. */
  signed: boolean;
  /** Every parameter as read, in order (kept as-is when paying). */
  params: [string, string][];
  /** The QR text exactly as scanned. */
  raw: string;
}

/** Names billing apps / QR kits put in instead of the shop's ("Default", "Merchant", "NA"…). */
const PLACEHOLDER_NAMES = /^(default|merchant|merchants|payee|customer|name|na|n\/a|none|null|test|shop|store|upi|vpa|user|unknown|paytm merchant|phonepe merchant|bharatpe merchant|my shop|your name|business|seller|retailer)$/i;

/** True when the QR's name is a placeholder, not the shop's real name. */
export function placeholderName(pn: string | null | undefined): boolean {
  const n = (pn ?? '').trim();
  return !n || n.length < 2 || PLACEHOLDER_NAMES.test(n) || /^[\w.\-]+@[a-z]+$/i.test(n);
}

/** Read a upi://pay link; null when it isn't one or has no payee. */
export function parseUpiQr(raw: string): UpiQr | null {
  const text = (raw ?? '').trim();
  const m = text.match(/^upi:\/\/pay\?(.*)$/i);
  if (!m) return null;
  const params: [string, string][] = [];
  for (const part of m[1].split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeSafe(i >= 0 ? part.slice(0, i) : part).trim();
    const v = decodeSafe(i >= 0 ? part.slice(i + 1) : '').trim();
    if (k) params.push([k, v]);
  }
  const get = (k: string) => params.find(([pk]) => pk.toLowerCase() === k)?.[1] ?? null;
  const pa = get('pa');
  if (!pa || !/^[\w.\-]{2,}@[a-z][\w.]*$/i.test(pa)) return null;
  const amRaw = get('am');
  const am = amRaw && Number(amRaw) > 0 ? Number(amRaw) : null;
  const mc = get('mc');
  return {
    pa,
    pn: get('pn') || pa,
    am,
    mc: mc && mc !== '0000' ? mc : null,
    tn: get('tn'),
    signed: !!get('sign'),
    params,
    raw: text,
  };
}

/**
 * The link to hand to the UPI app: the QR's own parameters (signed QRs are
 * left untouched), with the amount and your note filled in.
 */
export function buildPayUri(qr: UpiQr, amount: number, note: string): string {
  // A signed (bank-issued) QR is passed on exactly as scanned, or its signature breaks.
  if (qr.signed) return qr.raw;
  const out = qr.params.filter(([k]) => !(qr.signed ? [] : ['am', 'tn', 'cu']).includes(k.toLowerCase()));
  if (!qr.signed) {
    out.push(['am', amount.toFixed(2)]);
    out.push(['cu', 'INR']);
    const tn = (note || qr.tn || '').trim().slice(0, 50);
    if (tn) out.push(['tn', tn]);
  }
  // Keep "@" literal in UPI ids: some apps don't decode %40.
  return 'upi://pay?' + out.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

export type UpiOutcome = 'success' | 'submitted' | 'failure' | 'unknown';

/** Read the UPI app's reply ("txnId=..&responseCode=00&Status=SUCCESS&txnRef=.."). */
export function parseUpiResponse(response: string | null | undefined): { status: UpiOutcome; ref: string | null } {
  if (!response) return { status: 'unknown', ref: null };
  const map: Record<string, string> = {};
  for (const part of response.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) map[part.slice(0, i).trim().toLowerCase()] = decodeSafe(part.slice(i + 1)).trim();
  }
  const s = (map['status'] ?? '').toLowerCase();
  const ref = map['approvalrefno'] || map['txnref'] || map['txnid'] || null;
  if (s === 'success' || s === 's') return { status: 'success', ref };
  if (s === 'submitted' || s === 'pending') return { status: 'submitted', ref };
  if (s === 'failure' || s === 'failed' || s === 'f') return { status: 'failure', ref };
  return { status: 'unknown', ref };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** A payment made with Scan & Pay, waiting for its bank SMS. */
export interface PaidHere {
  amount: number;
  at: number;
  vpa: string;
  name: string;
  ref: string;
  /** The expense saved for it, once saved. */
  expenseId?: string;
  /** Its note is only the UPI id (no name known): the bank SMS's payee name replaces it. */
  autoNote?: boolean;
}

const PAYEE_NAMES_KEY = 'artha.pay.payeeNames';

/** Shop names known for UPI ids whose QR has none ("Default"): { vpa: name }. */
export function payeeNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PAYEE_NAMES_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function savePayeeName(vpa: string, name: string): void {
  if (!vpa || !name) return;
  const all = payeeNames();
  all[vpa.toLowerCase()] = name;
  try {
    localStorage.setItem(PAYEE_NAMES_KEY, JSON.stringify(all));
  } catch {
    // This session only.
  }
}

/**
 * A payee name from a bank SMS that's good enough to show ("APOLLO DENTAL" →
 * "Apollo Dental"), or null for UPI ids, numbers, placeholders and the
 * user's own account.
 */
export function cleanPayeeName(raw: string | null | undefined): string | null {
  const n = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (n.length < 3 || n.length > 40) return null;
  if (n.includes('@') || n.replace(/\D/g, '').length >= 5 || placeholderName(n)) return null;
  if (/\b(a\/?c|acct|account|card|bank|upi|ref|imps|neft)\b/i.test(n)) return null;
  if (!/[a-z]{2}/i.test(n)) return null;
  // Bank SMS shout in capitals: make it readable.
  return n === n.toUpperCase()
    ? n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
    : n;
}

const AMOUNT_ONLY_MS = 30 * 60 * 1000;

/**
 * Which recorded payment (if any) this debit SMS is. The amount must be equal
 * and the SMS must name the UPI reference, the payee's UPI id or name - or,
 * with nothing to compare, be a non-card SMS within 30 minutes. Mirrors
 * UpiRecent.matchIndex on the phone.
 */
export function matchPaidIndex(list: PaidHere[], amount: number, body: string, now = Date.now()): number {
  const text = (body ?? '').toLowerCase();
  const flat = text.replace(/[^a-z0-9]/g, '');
  const cardSpend = /\b(card|pos|atm)\b/.test(text);
  // An SMS naming a UPI id or a 12-digit UPI reference is someone else's unless it matches below.
  const namesPayee = /[a-z0-9._-]{2,}@[a-z]{2,}/.test(text);
  const refs: string[] = text.match(/\b\d{12}\b/g) ?? [];
  let amountOnly = -1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (Math.abs(p.amount - amount) >= 0.005) continue;
    const vpa = (p.vpa ?? '').toLowerCase();
    const local = vpa.includes('@') ? vpa.slice(0, vpa.indexOf('@')) : vpa;
    const key = nameKey(p.name ?? '');
    if ((p.ref ?? '').length >= 6 && text.includes(p.ref.toLowerCase())) return i;
    if (vpa && text.includes(vpa)) return i;
    if (local.length >= 4 && flat.includes(local.replace(/[^a-z0-9]/g, ''))) return i;
    if (key.length >= 4 && flat.includes(key)) return i;
    const otherRef = !!p.ref && refs.length > 0 && !refs.includes(p.ref);
    if (!cardSpend && !namesPayee && !otherRef && amountOnly < 0 && now - p.at <= AMOUNT_ONLY_MS) amountOnly = i;
  }
  return amountOnly;
}

function nameKey(name: string): string {
  let out = '';
  for (const w of name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)) {
    if (out.length >= 8) break;
    out += w;
  }
  return out;
}
