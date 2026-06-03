import { Injectable, computed, inject, signal } from '@angular/core';
import { PlannedExpense, PlannedExpenseUpsertRequest } from '../../core/models/planned-expense.model';
import { PlannedExpensesApi } from './planned-expenses.api';

@Injectable({ providedIn: 'root' })
export class PlannedExpensesStore {
  private readonly api = inject(PlannedExpensesApi);

  private readonly _items = signal<PlannedExpense[]>([]);
  private readonly _includeArchived = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  // Same freshness pattern as CategoriesStore — planned expenses rarely change.
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 5 * 60_000;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly active = computed(() => this._items().filter((p) => !p.archived));
  readonly byId = computed(() => {
    const map: Record<string, PlannedExpense> = {};
    for (const p of this._items()) {
      map[p.id] = p;
    }
    return map;
  });
  // Total fixed monthly outlay across active planned expenses.
  readonly plannedTotal = computed(() =>
    this.active().reduce((sum, p) => sum + p.amount, 0),
  );

  async load(includeArchived = false, force = false): Promise<void> {
    if (!force
        && this._lastLoadedAt > 0
        && Date.now() - this._lastLoadedAt < PlannedExpensesStore.FreshnessWindowMs
        && this._includeArchived() === includeArchived) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this._includeArchived.set(includeArchived);
    try {
      this._items.set(await this.api.list(includeArchived));
      this._lastLoadedAt = Date.now();
    } catch (err) {
      this._error.set('Could not load planned expenses.');
    } finally {
      this._loading.set(false);
    }
  }

  async add(request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    const created = await this.api.create(request);
    this._items.update((items) => [...items, created]);
    return created;
  }

  async update(id: string, request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    const updated = await this.api.update(id, request);
    this._items.update((items) => items.map((p) => (p.id === id ? updated : p)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    // Server soft-deletes (Archived = true). Force a reload so the
    // archived state is reflected (cache check would otherwise short-circuit).
    await this.load(this._includeArchived(), /* force */ true);
  }
}
