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
  'restaurant', 'fast-food', 'cafe', 'cart', 'basket', 'bag-handle',
  'car', 'bus', 'train', 'airplane', 'home', 'build',
  'flash', 'water', 'wifi', 'phone-portrait', 'tv', 'game-controller',
  'musical-notes', 'film', 'fitness', 'medkit', 'heart', 'school',
  'book', 'gift', 'shirt', 'paw', 'leaf', 'cash',
  'card', 'receipt', 'pricetag', 'umbrella',
];
