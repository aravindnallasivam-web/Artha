const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90, a: 1, an: 1,
};
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, k: 1000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  million: 1_000_000, crore: 10_000_000, crores: 10_000_000,
};

/**
 * An amount from speech: "250", "₹1,250.50", "250 rupees", "two hundred and
 * fifty", "1.5 lakh", "twelve thousand five hundred". Null when there's none.
 */
export function spokenAmount(text: string): number | null {
  const t = (text ?? '').toLowerCase().replace(/,/g, '').replace(/₹|rs\.?|inr|rupees?|bucks/g, ' ').trim();
  if (!t) return null;
  // Digits, maybe with a scale word: "1.5 lakh", "12 thousand".
  const d = t.match(/(\d+(?:\.\d+)?)\s*(hundred|thousand|k|lakhs?|lacs?|million|crores?)?/);
  if (d) {
    const v = Number(d[1]) * (d[2] ? SCALES[d[2]] : 1);
    // "250 and 50 paise" → 250.50
    const paise = t.match(/and\s+(\d{1,2})\s*paise/);
    return Math.round((v + (paise ? Number(paise[1]) / 100 : 0)) * 100) / 100;
  }
  // Words: "two hundred and fifty", "twelve thousand five hundred".
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of t.split(/[\s-]+/)) {
    if (w === 'and') continue;
    if (w in UNITS) {
      current += UNITS[w];
      seen = true;
    } else if (w in SCALES) {
      const s = SCALES[w];
      if (s === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * s;
        current = 0;
      }
      seen = true;
    } else if (seen) {
      break; // "two hundred for coffee": stop at the first non-number word
    }
  }
  return seen ? total + current : null;
}
