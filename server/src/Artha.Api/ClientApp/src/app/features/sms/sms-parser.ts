import { SmsMessage } from '../../core/native/sms-reader';

/** A bank-SMS that looks like a transaction, extracted on-device. */
export interface ParsedExpense {
  amount: number;
  /** 'expense' for a debit/spend, 'income' for a credit/money-in. */
  type: 'expense' | 'income';
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
  /**
   * ISO code of the currency the SMS amount is in (e.g. 'INR', 'USD'). Card
   * spends abroad quote a foreign currency; the confirm dialog uses this to
   * warn that the figure needs converting before it's logged.
   */
  currency: string | null;
  /** The sender address (bank short-code). */
  sender: string;
  /** Original message body, kept for the confirm dialog / note. */
  raw: string;
}

// Amount tokens: local INR forms (Rs/INR/₹) plus the foreign currencies an
// Indian card commonly quotes abroad ("USD 23.60", "$23.60", "AED 90").
const CURRENCY_TOKEN = '(rs\\.?|inr|usd|eur|gbp|aed|sgd|aud|cad|jpy|chf|hkd|myr|thb|sar|qar|npr|₹|\\$|€|£)';
const AMOUNT_SCAN_RE = new RegExp(`${CURRENCY_TOKEN}\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'gi');
// When the text right before an amount talks about a balance, credit limit or
// outstanding/due figure, that number is NOT the transaction amount — it's the
// "Avl Bal" / "Avl Limit" the bank tacks on. We must never grab it as the spend.
const NON_TXN_CONTEXT_RE = /(avl|avbl|available|bal|balance|limit|lmt|outstanding|o\/s|due)\s*[:.\-]?\s*$/i;
// Spend verbs vs. incoming-money verbs. "sent"/"transferred" cover the newer
// UPI alerts (e.g. HDFC "Sent Rs.70.00 From A/C .. To ..").
const DEBIT_RE = /\b(debited|spent|sent|transferred|withdrawn|withdrawal|purchase|paid|payment|deducted|charged|debit)\b/i;
const CREDIT_RE = /\b(credited|received|refund|reversal|deposited|salary|cashback)\b/i;
// "A/c XX1234", "card ending 1234", "Acct no. 5678".
const ACCOUNT_RE = /\b(?:a\/c|acct|account|card)\b[^\d]{0,12}(\d{3,4})\b/i;
// "Avl Bal Rs.45,000", "Available Balance: INR 45000", "A/c Bal: Rs 45000",
// and currency-less forms like "Avbl Bal: 12,340.55" / "Avl Bal 5000". The
// currency token is optional because many banks omit it in transaction alerts;
// the amount must still sit right after "bal" so we never grab an a/c number.
const BALANCE_RE = /bal(?:ance)?\s*(?:is|:|-)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;
// Card spends read "... on <DD-Mon-YY> on <MERCHANT>" or "... at <MERCHANT> on
// <date>" — the merchant sits after the date, introduced by "on"/"at". Tried
// first because the generic rule below doesn't treat "on" as a connective.
const MERCHANT_CARD_RE = /\bon\s+\d{1,2}[-/ ][A-Za-z]{3,}[-/ ]\d{2,4}\s+(?:at|on)\s+([A-Za-z0-9][A-Za-z0-9 ._@&'\-]{1,39})/i;
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

// Balance-enquiry replies often put a whole clause between "balance" and the
// amount, e.g. "Your Balance in account no. ending with 9772 is Rs. 44,453.57".
// More lenient than BALANCE_RE (which expects the amount right after "bal").
const BALANCE_REPLY_RE = /bal(?:ance)?\b[\s\S]{0,60}?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

/** Extract the available balance from a balance-enquiry reply SMS, or null. */
export function extractBalance(body: string): number | null {
  const m = (body ?? '').match(BALANCE_REPLY_RE);
  if (!m) {
    return null;
  }
  const value = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(value) ? value : null;
}

/** Map a matched currency token to its ISO code. */
function normaliseCurrency(token: string): string {
  switch (token.toLowerCase().replace(/\.$/, '')) {
    case 'rs':
    case 'inr':
    case '₹':
      return 'INR';
    case '$':
      return 'USD';
    case '€':
      return 'EUR';
    case '£':
      return 'GBP';
    default:
      return token.toUpperCase();
  }
}

/**
 * Find the transaction amount: the first currency-tagged figure that isn't a
 * balance/limit/outstanding number. Returns the value and its ISO currency, so
 * a foreign-currency spend ("USD 23.60") is read correctly instead of falling
 * through to the "Avl Limit: INR ..." figure later in the message.
 */
function extractAmount(body: string): { value: number; currency: string } | null {
  AMOUNT_SCAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_SCAN_RE.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 16), m.index);
    if (NON_TXN_CONTEXT_RE.test(before)) {
      continue;
    }
    const value = parseFloat(m[2].replace(/,/g, ''));
    if (isFinite(value) && value > 0) {
      return { value, currency: normaliseCurrency(m[1]) };
    }
  }
  return null;
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
 * Parse a single SMS into a transaction (debit -> expense, credit -> income),
 * or return null when it isn't one (no amount, an OTP/promo, or an ambiguous
 * message). Pure + on-device.
 */
export function parseExpenseSms(msg: SmsMessage): ParsedExpense | null {
  const body = (msg.body ?? '').trim();
  if (!body || NOISE_RE.test(body)) {
    return null;
  }

  const amountHit = extractAmount(body);
  if (!amountHit) {
    return null;
  }
  const amount = amountHit.value;

  const isDebit = DEBIT_RE.test(body);
  const isCredit = CREDIT_RE.test(body);
  // A clear debit is an expense; a clear credit is income. If neither verb is
  // present, or both are (ambiguous), we can't be confident — skip.
  let type: 'expense' | 'income';
  if (isDebit && !isCredit) {
    type = 'expense';
  } else if (isCredit && !isDebit) {
    type = 'income';
  } else {
    return null;
  }

  const merchantMatch = body.match(MERCHANT_CARD_RE) ?? body.match(MERCHANT_RE);
  const merchant = merchantMatch ? cleanMerchant(merchantMatch[1]) : null;
  const accountMatch = body.match(ACCOUNT_RE);
  const balanceMatch = body.match(BALANCE_RE);
  const balance = balanceMatch
    ? parseFloat(balanceMatch[1].replace(/,/g, ''))
    : null;

  return {
    amount,
    type,
    merchant,
    accountHint: accountMatch ? accountMatch[1] : null,
    date: toIsoDate(msg.date),
    // Category guessing is expense-oriented; income usually has no match (the
    // user picks one in the confirm dialog).
    suggestedCategory: type === 'expense' ? guessCategory(merchant, body) : null,
    balance: balance !== null && isFinite(balance) ? balance : null,
    currency: amountHit.currency,
    sender: msg.address ?? '',
    raw: body,
  };
}
