/** Words that point to a category, for a place type (Google / OpenStreetMap "dentist", "cafe"…). */
export function hintWords(kind: string | null | undefined): string[] {
  const k = (kind ?? '').toLowerCase();
  if (!k) return [];
  if (/dent/.test(k)) return ['dental', 'dentist', 'health', 'medical'];
  if (/pharm|chemist|drugstore/.test(k)) return ['pharmacy', 'medicine', 'medical', 'health'];
  if (/clinic|doctor|hospital|health|physio|lab|diagnostic/.test(k)) return ['doctor', 'medical', 'health', 'hospital'];
  if (/cafe|coffee|tea/.test(k)) return ['cafe', 'café', 'coffee', 'food'];
  if (/bakery|confection|ice_cream|dessert|sweet/.test(k)) return ['bakery', 'snacks', 'sweets', 'food'];
  if (/restaurant|fast_food|food|meal|diner|bar|pub/.test(k)) return ['dining', 'restaurant', 'eating out', 'food'];
  if (/supermarket|grocery|convenience|greengrocer|marketplace|market|dairy|butcher|meat|fish/.test(k))
    return ['groceries', 'grocery', 'dairy', 'meat', 'fruits', 'vegetables', 'food'];
  if (/fuel|gas_station|petrol|charging/.test(k)) return ['fuel', 'petrol', 'vehicle', 'transport'];
  if (/car|motor|auto|garage|tyre|bike/.test(k)) return ['vehicle', 'car', 'maintenance', 'transport'];
  if (/cinema|movie|theater|theatre|amusement|bowling|park/.test(k)) return ['movies', 'entertainment', 'fun'];
  if (/hair|beauty|salon|spa|barber/.test(k)) return ['personal care', 'salon', 'grooming', 'beauty'];
  if (/gym|fitness|sport|yoga|swimming/.test(k)) return ['fitness', 'gym', 'health', 'sports'];
  if (/electronics|mobile|phone|computer/.test(k)) return ['electronics', 'gadgets', 'shopping'];
  if (/cloth|shoe|fashion|jewel|department|mall|gift|apparel/.test(k)) return ['clothes', 'clothing', 'shopping'];
  if (/hardware|furniture|home_goods|doityourself|houseware/.test(k)) return ['home', 'household', 'shopping'];
  if (/book|stationery|school|college|education|tuition/.test(k)) return ['education', 'books', 'school'];
  if (/hotel|lodging|guest|hostel|travel|airport|train|bus/.test(k)) return ['travel', 'hotel', 'transport'];
  if (/bank|atm|finance|insurance/.test(k)) return ['bank', 'finance', 'fees'];
  if (/store|shop/.test(k)) return ['shopping'];
  return [];
}

/**
 * Categories that fit a shop: its place type first, then words of its name
 * ("Apollo Dental" → Dental). `cats` are { id, name, path } with path like
 * "Health › Dental". Returns ids, best first.
 */
export function suggestCategories(
  cats: { id: string; name: string; path: string }[],
  kind: string | null | undefined,
  shopName: string | null | undefined,
): string[] {
  const score = new Map<string, number>();
  const add = (id: string, s: number) => score.set(id, Math.max(score.get(id) ?? 0, s));
  const words = hintWords(kind);
  words.forEach((w, i) => {
    for (const c of cats) {
      const n = c.name.toLowerCase();
      // Exact name beats "contains"; earlier (more specific) words beat later ones; subcategories beat groups.
      if (n === w) add(c.id, 100 - i * 5 + (c.path.includes('›') ? 3 : 0));
      else if (n.includes(w)) add(c.id, 80 - i * 5 + (c.path.includes('›') ? 3 : 0));
    }
  });
  for (const w of (shopName ?? '').toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 4)) {
    for (const c of cats) {
      const n = c.name.toLowerCase();
      if (n === w || n.startsWith(w) || w.startsWith(n)) add(c.id, 90);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
