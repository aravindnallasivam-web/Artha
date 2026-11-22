import { Injectable, computed, inject, signal } from '@angular/core';
import { AppEvent, AppEventUpsert, eventCovers } from '../../core/models/event.model';
import { EventsDriveService } from './events.drive';

@Injectable({ providedIn: 'root' })
export class EventsStore {
  private readonly drive = inject(EventsDriveService);

  private readonly _items = signal<AppEvent[]>([]);
  private loaded: Promise<void> | null = null;

  readonly items = this._items.asReadonly();
  readonly active = computed(() => this._items().filter((e) => !e.archived));
  readonly byId = computed(() => Object.fromEntries(this._items().map((e) => [e.id, e])) as Record<string, AppEvent>);
  /** Events happening today. */
  readonly ongoing = computed(() => {
    const today = localToday();
    return this.active().filter((e) => eventCovers(e, today)).sort((a, b) => b.start.localeCompare(a.start));
  });

  /** Load once (again with force). */
  ensureLoaded(force = false): Promise<void> {
    if (!this.loaded || force) {
      this.loaded = this.drive
        .list()
        .then((items) => this._items.set(items))
        .catch(() => {
          this.loaded = null;
        });
    }
    return this.loaded ?? Promise.resolve();
  }

  /** The event an expense on `date` belongs to: the most recently started one covering it. */
  eventFor(date: string): AppEvent | null {
    return this.active()
      .filter((e) => eventCovers(e, date))
      .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
  }

  async add(r: AppEventUpsert): Promise<AppEvent> {
    const created = await this.drive.create(r);
    this._items.update((l) => [...l, created]);
    return created;
  }

  async update(id: string, r: AppEventUpsert): Promise<AppEvent> {
    const updated = await this.drive.update(id, r);
    this._items.update((l) => l.map((e) => (e.id === id ? updated : e)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.drive.remove(id);
    this._items.update((l) => l.map((e) => (e.id === id ? { ...e, archived: true } : e)));
  }
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
