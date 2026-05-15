import { Injectable, computed, inject, signal } from '@angular/core';
import { Account, AccountUpsertRequest } from '../../core/models/account.model';
import { AccountsApi } from './accounts.api';

@Injectable({ providedIn: 'root' })
export class AccountsStore {
  private readonly api = inject(AccountsApi);

  private readonly _items = signal<Account[]>([]);
  private readonly _includeArchived = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  // Same freshness pattern as CategoriesStore — accounts rarely change.
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 5 * 60_000;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly active = computed(() => this._items().filter((a) => !a.archived));
  readonly byId = computed(() => {
    const map: Record<string, Account> = {};
    for (const a of this._items()) {
      map[a.id] = a;
    }
    return map;
  });

  async load(includeArchived = false, force = false): Promise<void> {
    if (!force
        && this._lastLoadedAt > 0
        && Date.now() - this._lastLoadedAt < AccountsStore.FreshnessWindowMs
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
      this._error.set('Could not load accounts.');
    } finally {
      this._loading.set(false);
    }
  }

  async add(request: AccountUpsertRequest): Promise<Account> {
    const created = await this.api.create(request);
    this._items.update((items) => [...items, created]);
    return created;
  }

  async update(id: string, request: AccountUpsertRequest): Promise<Account> {
    const updated = await this.api.update(id, request);
    this._items.update((items) => items.map((a) => (a.id === id ? updated : a)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    // Server soft-deletes (Archived = true). Force a reload so the
    // archived state is reflected (cache check would otherwise short-circuit).
    await this.load(this._includeArchived(), /* force */ true);
  }
}
