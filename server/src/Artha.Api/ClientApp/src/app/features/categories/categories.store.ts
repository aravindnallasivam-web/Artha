import { Injectable, computed, inject, signal } from '@angular/core';
import { Category, CategoryUpsertRequest } from '../../core/models/category.model';
import { CategoriesApi } from './categories.api';

/** One entry in a category <select>: a top-level category or a subcategory. */
export interface CategoryOption {
  id: string;
  name: string;
  /** Display label — the plain name, or an indented name for a subcategory. */
  label: string;
  isChild: boolean;
}

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

  /** Active top-level categories (no parent). */
  readonly topLevel = computed(() => this.active().filter((c) => !c.parentId));

  /** Active subcategories grouped by their parent id, each list name-sorted. */
  readonly childrenByParent = computed(() => {
    const map: Record<string, Category[]> = {};
    for (const c of this.active()) {
      if (c.parentId) {
        (map[c.parentId] ??= []).push(c);
      }
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  });

  /** Active subcategories of a given parent, name-sorted. */
  subcategoriesOf(parentId: string): Category[] {
    return this.childrenByParent()[parentId] ?? [];
  }

  /**
   * Flat, ordered options for a category <select>: each top-level category
   * followed by its subcategories (indented). Single source of truth for every
   * category picker so the hierarchy shows consistently everywhere.
   */
  readonly pickerOptions = computed<CategoryOption[]>(() => {
    const tops = [...this.topLevel()].sort((a, b) => a.name.localeCompare(b.name));
    const out: CategoryOption[] = [];
    for (const top of tops) {
      out.push({ id: top.id, name: top.name, label: top.name, isChild: false });
      for (const child of this.subcategoriesOf(top.id)) {
        out.push({ id: child.id, name: child.name, label: `  ${child.name}`, isChild: true });
      }
    }
    return out;
  });

  /** The top-level ancestor id for a category (itself if already top-level). */
  rootIdOf(id: string): string {
    return this.byId()[id]?.parentId ?? id;
  }

  /** "Parent · Child" for a subcategory, or just the name for a top-level one. */
  pathLabel(id: string): string {
    const map = this.byId();
    const cat = map[id];
    if (!cat) {
      return '';
    }
    const parent = cat.parentId ? map[cat.parentId] : undefined;
    return parent ? `${parent.name} · ${cat.name}` : cat.name;
  }

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

  /** Merge the source categories into the target (expenses reassigned
      server-side, sources archived). Forces a reload afterwards. */
  async merge(targetId: string, sourceIds: string[]): Promise<void> {
    await this.api.merge(targetId, sourceIds);
    await this.load(this._includeArchived(), /* force */ true);
  }
}
