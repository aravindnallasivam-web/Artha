// Drive data contracts + sharding helpers.
//
// Faithful TypeScript port of the server's Artha.Core.Drive types. Artha's
// data lives as plain JSON files in the user's Google Drive `appDataFolder`;
// these interfaces describe those files so the app can read/write them
// directly (serverless), in exactly the same shape the old .NET API used —
// so existing users' Drive data stays compatible.

import { Account } from '../models/account.model';
import { Category } from '../models/category.model';
import { Expense } from '../models/expense.model';
import { PlannedExpense } from '../models/planned-expense.model';

/** Current on-disk schema version. Bump in lockstep with a migration. */
export const SCHEMA_VERSION = 1;

/** Well-known Drive file names (mirror DriveFileNames.cs). */
export const DRIVE_FILES = {
  manifest: 'manifest.json',
  categories: 'categories.json',
  accounts: 'accounts.json',
  settings: 'settings.json',
  plannedExpenses: 'planned-expenses.json',
} as const;

/** Default Cash account seeded for every user (mirror DefaultAccountId). */
export const DEFAULT_ACCOUNT_ID = 'acc-cash';

const SHARD_PREFIX = 'expenses-';
const SHARD_SUFFIX = '.json';

/** Anything persisted to Drive carries a schemaVersion for forward-guarding. */
export interface SchemaVersioned {
  schemaVersion: number;
}

export interface Manifest extends SchemaVersioned {
  /** Month keys ('YYYY-MM') that have an expense shard. */
  shards: string[];
  createdAt: string;
}

export interface ExpenseShard extends SchemaVersioned {
  items: Expense[];
}

export interface CategoryList extends SchemaVersioned {
  items: Category[];
}

export interface AccountList extends SchemaVersioned {
  items: Account[];
}

export interface PlannedExpenseList extends SchemaVersioned {
  items: PlannedExpense[];
}

export interface SettingsDocument extends SchemaVersioned {
  currency: string;
  firstRunCompleted: boolean;
  locale?: string | null;
}

// ── YearMonth ───────────────────────────────────────────────────────────────

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Month of an ISO 'YYYY-MM-DD' date. */
export function ymFromDate(isoDate: string): YearMonth {
  const [y, m] = isoDate.split('-');
  return { year: Number(y), month: Number(m) };
}

export function ymToString(ym: YearMonth): string {
  return `${pad(ym.year, 4)}-${pad(ym.month, 2)}`;
}

export function ymParse(yyyyMm: string): YearMonth {
  const [y, m] = yyyyMm.split('-');
  const year = Number(y);
  const month = Number(m);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Expected YYYY-MM, got '${yyyyMm}'.`);
  }
  return { year, month };
}

/** -1 / 0 / 1 ordering, chronological. */
export function ymCompare(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

export function ymAddMonths(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

// ── Shard naming + selection (mirror DriveFileNames / ExpenseShardOps) ────────

export function shardFor(ym: YearMonth): string {
  return `${SHARD_PREFIX}${ymToString(ym)}${SHARD_SUFFIX}`;
}

export function shardForDate(isoDate: string): string {
  return shardFor(ymFromDate(isoDate));
}

/** Shard file names listed in the manifest that fall within [from, to]. */
export function shardsInRange(manifest: Manifest, from: YearMonth, to: YearMonth): string[] {
  return manifest.shards
    .map(ymParse)
    .filter((m) => ymCompare(m, from) >= 0 && ymCompare(m, to) <= 0)
    .sort(ymCompare)
    .map(shardFor);
}

/** Every shard in the manifest, newest month first — used for id lookups. */
export function shardsNewestFirst(manifest: Manifest): { month: YearMonth; shardName: string }[] {
  return manifest.shards
    .map(ymParse)
    .sort((a, b) => ymCompare(b, a))
    .map((month) => ({ month, shardName: shardFor(month) }));
}

export function emptyManifest(): Manifest {
  return { schemaVersion: SCHEMA_VERSION, shards: [], createdAt: new Date().toISOString() };
}

/**
 * Fresh entity id, e.g. newId('cat') -> 'cat-9f8e...'. Mirrors the server's
 * `{prefix}-{Guid:N}` (32 hex chars, no dashes).
 */
export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid.replace(/-/g, '')}`;
}
