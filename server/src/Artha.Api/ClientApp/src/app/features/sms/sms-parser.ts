import { SmsMessage } from '../../core/native/sms-reader';

/** A bank-SMS that looks like a spend, extracted on-device. */
export interface ParsedExpense {
  amount: number;
  /** Best-guess merchant / payee, or null if none found. */
  merchant: string | null;
  /** Last 3–4 digits of the account/card the SMS mentions, if any. */
  accountHint: string | null;
  /** Transaction date as YYYY-MM-DD (from the SMS timestamp). */
  date: string;
  /** Canonical category name guessed from the merchant, or null. */
  suggestedCategory: string | null;
  /** Available balance reported by the SMS, if any (to sync the account). */
  balance: number | null;
  /** The sender address (bank short-code). */
  sender: string;
  /** Original message body, kept for the confirm dialog / note. */
  raw: string;
}

// Amount like "Rs. 1,240.50", "INR 320", "₹2,899".
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
// Spend verbs vs. incoming-money verbs. "sent"/"transferred" cover the newer
// UPI alerts (e.g. HDFC "Sent Rs.70.00 From A/C .. To ..").
const DEBIT_RE = /\b(debited|spent|sent|transferred|withdrawn|withdrawal|purchase|paid|payment|deducted|charged|debit)\b/i;
const CREDIT_RE = /\b(credited|received|refund|reversal|deposited|salary|cashback)\b/i;
// "A/c XX1234", "card ending 1234", "Acct no. 5678".
const ACCOUNT_RE = /\b(?:a\/c|acct|account|card)\b[^\d]{0,12}(\d{3,4})\b/i;
// "Avl Bal Rs.45,000", "Available Balance: INR 45000", "A/c Bal: Rs 45000".
const BALANCE_RE = /bal(?:ance)?\s*(?:is|:|-)?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
// Merchant after a connective keyword.
const MERCHANT_RE = /(?:\bat\s+|\bto\s+|\bvpa\s+|\binfo[:\-]\s*|\btowards\s+|\bfor\s+)([A-Za-z0-9][A-Za-z0-9 ._@&'\-*]{1,39})/i;
// Messages we never want to treat as a transaction.
const NOISE_RE = /\b(otp|one[\s-]?time\s?password|do not share|verification code|will be debited|has been blocked|requested|e-?mandate|emi due|payment due|bill of|statement|is due|reward points|offer)\b/i;

const CATEGORY_KEYWORDS: { test: RegExp; category: string }[] = [
  { test: /swiggy|zomato|restaurant|cafe|coffee|pizza|biryani|mcdonald|kfc|domino|food|eatery|bakery|hotel\b/i, category: 'Food' },
  { test: /bigbasket|blinkit|zepto|dmart|grofers|supermarket|grocery|kirana|reliance fresh|more retail/i, category: 'Groceries' },
  { test: /uber|ola|rapido|metro|irctc|railway|redbus|fuel|petrol|diesel|hpcl|iocl|bpcl|fastag|parking|toll/i, category: 'Transport' },
  { test: /amazon|flipkart|myntra|ajio|nykaa|meesho|lifestyle|shoppers stop|store|mart|retail|mall/i, category: 'Shopping' },
  { test: /electricity|water|gas|broadband|wifi|dth|recharge|airtel|jio|vodafone|vi\b|bsnl|bill\b|utility/i, category: 'Bills' },
  { test: /netflix|spotify|prime|hotstar|subscription|youtube|membership/i, category: 'Entertainment' },
  { test: /pharmacy|apollo|medplus|hospital|clinic|medical|chemist|1mg|pharmeasy/i, category: 'Health' },
];

/** Extract the available balance from any SMS body, or null. */
export function extractBalance(body: string): number | null {
  const m = (body ?? '').match(BALANCE_RE);
  if (!m) {
    return null;
  }
  const value = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(value) ? value : null;
}

function guessCategory(merchant: string | null, body: string): string | null {
  const hay = `${merchant ?? ''} ${body}`;
  for (const { test, category } of CATEGORY_KEYWORDS) {
    if (test.test(hay)) {
      return category;
    }
  }
  return null;
}

function cleanMerchant(raw: string): string | null {
  let m = raw.trim();
  // Stop at common trailing clauses ("... on 03-06", "... Avl Bal", "... Ref no").
  m = m.split(/\s+(?:on|avl|ref|bal|info|txn|upi|not you|call|dial|towards)\b/i)[0];
  m = m.replace(/[*_.\-\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
  // Drop pure-numeric or too-short leftovers.
  if (m.length < 2 || /^\d+$/.test(m)) {
    return null;
  }
  return m;
}

function toIsoDate(epochMs: number): string {
  const d = epochMs > 0 ? new Date(epochMs) : new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Parse a single SMS into a spend, or return null when it isn't an expense
 * (no amount, an incoming credit, an OTP/promo, etc.). Pure + on-device.
 */
export function parseExpenseSms(msg: SmsMessage): ParsedExpense | null {
  const body = (msg.body ?? '').trim();
  if (!body || NOISE_RE.test(body)) {
    return null;
  }

  const amountMatch = body.match(AMOUNT_RE);
  if (!amountMatch) {
    return null;
  }
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (!isFinite(amount) || amount <= 0) {
    return null;
  }

  const isDebit = DEBIT_RE.test(body);
  const isCredit = CREDIT_RE.test(body);
  // Only debits are expenses. If it's clearly a credit, skip. If neither verb
  // is present we can't be confident it's a spend, so skip too.
  if (!isDebit || isCredit) {
    return null;
  }

  const merchantMatch = body.match(MERCHANT_RE);
  const merchant = merchantMatch ? cleanMerchant(merchantMatch[1]) : null;
  const accountMatch = body.match(ACCOUNT_RE);
  const balanceMatch = body.match(BALANCE_RE);
  const balance = balanceMatch
    ? parseFloat(balanceMatch[1].replace(/,/g, ''))
    : null;

  return {
    amount,
    merchant,
    accountHint: accountMatch ? accountMatch[1] : null,
    date: toIsoDate(msg.date),
    suggestedCategory: guessCategory(merchant, body),
    balance: balance !== null && isFinite(balance) ? balance : null,
    sender: msg.address ?? '',
    raw: body,
  };
}
