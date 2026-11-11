import { ParsedExpense } from './sms-parser';

/** Words that mark a business name ("Sri Balaji Stores", "Apollo Pharmacy"). */
const BUSINESS = new RegExp(
  '\\b(store|stores|mart|supermarket|market|enterprises?|traders?|trading|foods?|cafe|caf\u00e9|coffee|restaurant|hotel|' +
    'bakery|bakers|sweets|kitchen|dhaba|ltd|limited|pvt|private|llp|inc|services?|solutions?|technologies|tech|' +
    'medical|medicals|pharmacy|pharma|chemists?|clinic|hospital|diagnostics?|labs?|petrol|fuel|filling|motors?|' +
    'automobiles?|garage|agency|agencies|centre|center|shop|shoppe|boutique|textiles?|fashions?|electronics?|' +
    'mobiles?|telecom|broadband|fibernet|recharge|bharatpe|paytm|phonepe|razorpay|cashfree|payu|billdesk|' +
    'swiggy|zomato|amazon|flipkart|uber|ola|rapido|irctc|blinkit|zepto|bigbasket|dmart|reliance|tata|jio|airtel|' +
    'india|corporation|co|company|works|industries|associates|studio|salon|spa|gym|fitness|school|college|academy|' +
    'tuition|travels?|tours|logistics|courier|bank|finance|insurance|mutual|fund|securities|trust|foundation)\\b',
  'i',
);

/** UPI payment-gateway / merchant QR handles ("paytmqr…", "bharatpe.…", "q123@ybl"). */
const MERCHANT_VPA = /^(paytmqr|bharatpe|q\d|mab\.|gpay-|merchant|pos|razorpay|cf\.|payu|ezetap|pinelabs|mswipe)/i;

/**
 * True when this SMS looks like money sent to a person (a friend, a relative)
 * rather than paid at a shop: a phone number or personal UPI id as the payee,
 * or a plain personal name on a UPI transfer. Learning "this payee → category"
 * from such a transfer is usually wrong next time, so it is off by default.
 */
export function looksLikePersonTransfer(p: ParsedExpense): boolean {
  const merchant = (p.merchant ?? '').trim();
  const raw = p.raw ?? '';
  const isUpi = /\bupi\b|\bvpa\b|@[a-z]{2,}/i.test(raw);
  // "Sent Rs.500 From HDFC Bank A/C x1234 To RAVI KUMAR" - a transfer, not a card spend.
  const isTransfer = isUpi || /\b(sent|transferred|transfer|imps|neft|received from|credited.{0,40}\bfrom)\b/i.test(raw);
  // Merchant QR / gateway ids ("paytmqr2810…") are shops, digits or not.
  if (MERCHANT_VPA.test(merchant)) return false;
  // A phone number as the payee ("to 98765 43210" / "9876543210@ybl").
  if (merchant.replace(/[^0-9]/g, '').length >= 10) return true;
  const vpa = raw.match(/\b([a-z0-9._-]{2,})@([a-z]{2,})\b/i);
  if (vpa) {
    const local = vpa[1];
    if (MERCHANT_VPA.test(local) || BUSINESS.test(local.replace(/[._-]/g, ' '))) return false;
    if (/^\d{10}$/.test(local.replace(/\D/g, '')) && local.replace(/\D/g, '').length === local.length) return true;
  }
  if (!merchant) return isUpi;
  if (BUSINESS.test(merchant)) return false;
  // A UPI id that isn't a merchant code ("ravi.k@okaxis", masked "*16-5@okicici").
  if (/@[a-z]{2,}/i.test(merchant)) return true;
  // "Ravi Kumar", "PRIYA S": 1–3 plain words on a UPI transfer.
  const words = merchant.split(/\s+/).filter(Boolean);
  return isTransfer && words.length <= 3 && words.every((w) => /^[a-z.]+$/i.test(w));
}

/** Default for "Remember category for next time": on for shops, off for people. */
export function rememberByDefault(p: ParsedExpense): boolean {
  return !looksLikePersonTransfer(p);
}
