import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Expense,
  ExpenseCreateRequest,
  ExpenseUpdateRequest,
} from '../../core/models/expense.model';
import { ExpensesApi } from './expenses.api';

@Injectable({ providedIn: 'root' })
export class ExpensesStore {
  private readonly api = inject(ExpensesApi);

  private readonly _items = signal<Expense[]>([]);
  private readonly _currency = signal<string>('USD');
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _range = signal<{ from: string; to: string } | null>(null);
  // Wall-clock timestamp of the last successful load. Used to skip redundant
  // refetches when the user navigates Dashboard -> Expenses -> Dashboard etc.
  // within a short window — server-side cache absorbs repeat hits anyway, but
  // this also avoids the loading spinner flash and the round-trip latency.
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 30_000;

  readonly items = this._items.asReadonly();
  readonly currency = this._currency.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly totalAmount = computed(() =>
    this._items().reduce((sum, e) => sum + e.amount, 0),
  );

  async load(from?: string, to?: string, force = false): Promise<void> {
    // Skip the API call if the same range was loaded recently. Cuts the
    // visible spinner + Drive round-trip when the user navigates back to
    // a page they were just on (Dashboard <-> Expenses, etc.). Pass
    // force=true to bypass — used after writes that need a fresh fetch.
    if (!force && this.isFresh(from, to)) {
      return;
    }

    this._loading.set(true);
    this._error.set(null);
    try {
      const response = await this.api.list(from, to);
      this._items.set(response.items);
      this._currency.set(response.currency);
      this._range.set(from && to ? { from, to } : null);
      this._lastLoadedAt = Date.now();
    } catch (err) {
      this._error.set(toMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  private isFresh(from?: string, to?: string): boolean {
    if (this._lastLoadedAt === 0) return false;
    if (Date.now() - this._lastLoadedAt > ExpensesStore.FreshnessWindowMs) return false;
    const current = this._range();
    const requestedKey = from && to ? `${from}|${to}` : 'all';
    const currentKey = current ? `${current.from}|${current.to}` : 'all';
    return requestedKey === currentKey;
  }

  async add(request: ExpenseCreateRequest): Promise<Expense> {
    const created = await this.api.create(request);
    this._items.update((items) => sortByDate([created, ...items]));
    return created;
  }

  async update(id: string, request: ExpenseUpdateRequest): Promise<Expense> {
    try {
      const updated = await this.api.update(id, request);
      this._items.update((items) =>
        sortByDate(items.map((e) => (e.id === id ? updated : e))),
      );
      return updated;
    } catch (err) {
      // On conflict (409 surfaced by the interceptor's toast), re-fetch to
      // sync with whatever the other device wrote. Force=true bypasses the
      // freshness check — without it the cache window would short-circuit
      // exactly when we need the freshest data.
      if (is409(err)) {
        const range = this._range();
        await this.load(range?.from, range?.to, /* force */ true);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    this._items.update((items) => items.filter((e) => e.id !== id));
  }

  findById(id: string): Expense | undefined {
    return this._items().find((e) => e.id === id);
  }
}

function sortByDate(items: Expense[]): Expense[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function toMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong loading expenses.';
}

function is409(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: number }).status === 409
  );
}
