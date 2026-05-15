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

  async load(includeArchived = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._includeArchived.set(includeArchived);
    try {
      this._items.set(await this.api.list(includeArchived));
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
    // Server soft-deletes (Archived = true). Reload to reflect.
    await this.load(this._includeArchived());
  }
}
