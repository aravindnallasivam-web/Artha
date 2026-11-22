// Drive-backed events: CRUD over events.json (one list file, like loans).
import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, notFound } from '../../core/drive/drive-errors';
import { DRIVE_FILES, EventList, SCHEMA_VERSION, newId } from '../../core/drive/drive-schema';
import { AppEvent, AppEventUpsert } from '../../core/models/event.model';

@Injectable({ providedIn: 'root' })
export class EventsDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async list(): Promise<AppEvent[]> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<EventList>(DRIVE_FILES.events);
    return doc?.document.items ?? [];
  }

  async create(request: AppEventUpsert): Promise<AppEvent> {
    const clean = validate(request);
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<EventList>(DRIVE_FILES.events);
    const now = new Date().toISOString();
    const created: AppEvent = { id: newId('evt'), archived: false, createdAt: now, updatedAt: now, ...clean };
    await this.repo.write<EventList>(
      DRIVE_FILES.events,
      { schemaVersion: SCHEMA_VERSION, items: [...(existing?.document.items ?? []), created] },
      existing?.etag,
    );
    return created;
  }

  async update(id: string, request: AppEventUpsert): Promise<AppEvent> {
    const clean = validate(request);
    return this.patch(id, clean);
  }

  /** Soft delete: the event is hidden; its expenses keep their link but stop showing it. */
  async remove(id: string): Promise<void> {
    await this.patch(id, { archived: true });
  }

  private async patch(id: string, fields: Partial<AppEvent>): Promise<AppEvent> {
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<EventList>(DRIVE_FILES.events);
    const list = [...(existing?.document.items ?? [])];
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) throw notFound();
    list[i] = { ...list[i], ...fields, updatedAt: new Date().toISOString() };
    await this.repo.write<EventList>(
      DRIVE_FILES.events,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
    return list[i];
  }
}

function validate(r: AppEventUpsert): AppEventUpsert {
  const name = (r.name ?? '').trim().slice(0, 60);
  if (!name) throw badRequest('Give the event a name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start) || !/^\d{4}-\d{2}-\d{2}$/.test(r.end)) {
    throw badRequest('Pick the start and end dates.');
  }
  if (r.end < r.start) throw badRequest('The end date is before the start.');
  const budget = r.budget != null && Number(r.budget) > 0 ? Math.round(Number(r.budget) * 100) / 100 : null;
  const people = Math.max(1, Math.min(50, Math.round(Number(r.people) || 1)));
  const emoji = (r.emoji ?? '').trim().slice(0, 8) || null;
  return { name, emoji, start: r.start, end: r.end, budget, people };
}
