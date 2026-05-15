import { Injectable, computed, inject, signal } from '@angular/core';
import { Category, CategoryUpsertRequest } from '../../core/models/category.model';
import { CategoriesApi } from './categories.api';

@Injectable({ providedIn: 'root' })
export class CategoriesStore {
  private readonly api = inject(CategoriesApi);

  private readonly _items = signal<Category[]>([]);
  private readonly _includeArchived = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  // Categories rarely change. After the first load, callers can safely
  // skip refetching for the rest of the session unless they pass force=true
  // (used by remove() because the soft-delete needs a fresh fetch to reflect
  // archived state). 5-min freshness window matches the server's Drive cache.
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 5 * 60_000;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly active = computed(() => this._items().filter((c) => !c.archived));
  readonly byId = computed(() => {
    const map: Record<string, Category> = {};
    for (const c of this._items()) {
      map[c.id] = c;
    }
    return map;
  });

  async load(includeArchived = false, force = false): Promise<void> {
    if (!force
        && this._lastLoadedAt > 0
        && Date.now() - this._lastLoadedAt < CategoriesStore.FreshnessWindowMs
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
      this._error.set('Could not load categories.');
    } finally {
      this._loading.set(false);
    }
  }

  async add(request: CategoryUpsertRequest): Promise<Category> {
    const created = await this.api.create(request);
    this._items.update((items) => [...items, created]);
    return created;
  }

  async update(id: string, request: CategoryUpsertRequest): Promise<Category> {
    const updated = await this.api.update(id, request);
    this._items.update((items) => items.map((c) => (c.id === id ? updated : c)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    // Server soft-deletes (Archived = true). Force a reload so the
    // archived state is reflected (cache check would otherwise short-circuit).
    await this.load(this._includeArchived(), /* force */ true);
  }
}
