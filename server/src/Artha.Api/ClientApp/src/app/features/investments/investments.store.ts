import { Injectable, computed, inject, signal } from '@angular/core';
import { Investment, InvestmentUpsertRequest } from '../../core/models/investment.model';
import { InvestmentsApi } from './investments.api';

@Injectable({ providedIn: 'root' })
export class InvestmentsStore {
  private readonly api = inject(InvestmentsApi);

  private readonly _items = signal<Investment[]>([]);
  private readonly _includeArchived = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  // Same freshness pattern as AccountsStore — investments rarely change.
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 5 * 60_000;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly active = computed(() => this._items().filter((i) => !i.archived));
  readonly byId = computed(() => {
    const map: Record<string, Investment> = {};
    for (const i of this._items()) {
      map[i.id] = i;
    }
    return map;
  });

  // Current value summed per currency — mixing currencies would be meaningless,
  // so the list page renders one total line per currency present.
  readonly totalsByCurrency = computed(() => {
    const totals: Record<string, number> = {};
    for (const i of this.active()) {
      totals[i.currency] = (totals[i.currency] ?? 0) + i.currentValue;
    }
    return totals;
  });

  async load(includeArchived = false, force = false): Promise<void> {
    if (!force
        && this._lastLoadedAt > 0
        && Date.now() - this._lastLoadedAt < InvestmentsStore.FreshnessWindowMs
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
      this._error.set('Could not load investments.');
    } finally {
      this._loading.set(false);
    }
  }

  async add(request: InvestmentUpsertRequest): Promise<Investment> {
    const created = await this.api.create(request);
    this._items.update((items) => [...items, created]);
    return created;
  }

  async update(id: string, request: InvestmentUpsertRequest): Promise<Investment> {
    const updated = await this.api.update(id, request);
    this._items.update((items) => items.map((i) => (i.id === id ? updated : i)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    // Server soft-deletes (Archived = true). Force a reload so the archived
    // state is reflected (cache check would otherwise short-circuit).
    await this.load(this._includeArchived(), /* force */ true);
  }
}
