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
