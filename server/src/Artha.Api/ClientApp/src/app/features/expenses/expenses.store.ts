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

  readonly items = this._items.asReadonly();
  readonly currency = this._currency.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly totalAmount = computed(() =>
    this._items().reduce((sum, e) => sum + e.amount, 0),
  );

  async load(from?: string, to?: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const response = await this.api.list(from, to);
      this._items.set(response.items);
      this._currency.set(response.currency);
      this._range.set(from && to ? { from, to } : null);
    } catch (err) {
      this._error.set(toMessage(err));
    } finally {
      this._loading.set(false);
    }
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
      // sync with whatever the other device wrote.
      if (is409(err)) {
        const range = this._range();
        await this.load(range?.from, range?.to);
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
