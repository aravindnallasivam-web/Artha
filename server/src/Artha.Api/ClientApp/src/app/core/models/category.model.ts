export interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  archived: boolean;
}

export interface CategoryUpsertRequest {
  name: string;
  color: string | null;
  icon: string | null;
}

/** Preset colour swatches offered in the category editor. */
export const CATEGORY_COLORS: string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#64748b', '#78716c', '#0f172a',
];

/**
 * Ionicon names offered in the category editor. Every name here must also be
 * registered in core/icons.ts so it renders.
 */
export const CATEGORY_ICONS: string[] = [
  // Food & drink
  'restaurant', 'fast-food', 'cafe', 'pizza', 'ice-cream', 'nutrition',
  'fish', 'egg', 'beer', 'wine',
  // Shopping
  'cart', 'basket', 'bag-handle', 'storefront', 'gift', 'shirt', 'glasses',
  // Transport
  'car', 'bus', 'train', 'airplane', 'bicycle', 'boat',
  // Home & bills
  'home', 'bed', 'key', 'build', 'construct', 'hammer', 'flash', 'water',
  'wifi', 'phone-portrait', 'call', 'mail', 'tv',
  // Health
  'medkit', 'medical', 'bandage', 'heart', 'fitness', 'barbell',
  // Kids & fun
  'game-controller', 'balloon', 'happy', 'musical-notes', 'film', 'ticket',
  // Education & hobbies
  'school', 'book', 'library', 'color-palette', 'brush',
  // Work & money
  'briefcase', 'business', 'people', 'cash', 'card', 'receipt', 'pricetag',
  // Misc
  'paw', 'leaf', 'flower', 'football', 'basketball', 'sparkles', 'cut', 'umbrella',
];
