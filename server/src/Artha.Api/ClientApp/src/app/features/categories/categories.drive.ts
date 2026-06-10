// Drive-backed categories service — port of CategoriesController.
//
// Same public surface as CategoriesApi, so swapping it in is a one-line change
// in the store. Reads/writes categories.json directly; merge + delete also walk
// the expense shards.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, conflict, notFound } from '../../core/drive/drive-errors';
import { DriveConflictError } from '../../core/drive/drive-rest.client';
import {
  CategoryList,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  SCHEMA_VERSION,
  newId,
  shardsNewestFirst,
} from '../../core/drive/drive-schema';
import { Category, CategoryUpsertRequest } from '../../core/models/category.model';

@Injectable({ providedIn: 'root' })
export class CategoriesDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async list(includeArchived = false): Promise<Category[]> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    return (doc?.document.items ?? []).filter((c) => includeArchived || !c.archived);
  }

  async create(request: CategoryUpsertRequest): Promise<Category> {
    const name = request.name?.trim();
    if (!name) {
      throw badRequest('Name is required.');
    }
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    const list = existing?.document.items ?? [];
    const parentId = request.parentId ?? null;
    this.validateParent(list, parentId, null);
    if (this.nameTaken(list, name, parentId, null)) {
      throw badRequest(`A category named '${name}' already exists here.`);
    }

    const created: Category = {
      id: newId('cat'),
      name,
      color: request.color,
      icon: request.icon,
      archived: false,
      excludeFromReports: request.excludeFromReports,
      parentId,
    };
    await this.repo.write<CategoryList>(
      DRIVE_FILES.categories,
      { schemaVersion: SCHEMA_VERSION, items: [...list, created] },
      existing?.etag,
    );
    return created;
  }

  async update(id: string, request: CategoryUpsertRequest): Promise<Category> {
    const name = request.name?.trim();
    if (!name) {
      throw badRequest('Name is required.');
    }
    await this.bootstrap.ensureInitialized();

    const existing = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw notFound();
    }
    const parentId = request.parentId ?? null;
    if (parentId !== null) {
      if (parentId === id) {
        throw badRequest('A category cannot be its own parent.');
      }
      // One level deep: a category that already has subcategories can't become one.
      if (list.some((c) => !c.archived && c.parentId === id)) {
        throw badRequest('This category has subcategories, so it cannot become a subcategory itself.');
      }
    }
    this.validateParent(list, parentId, id);
    if (this.nameTaken(list, name, parentId, id)) {
      throw badRequest(`A category named '${name}' already exists here.`);
    }

    list[idx] = {
      ...list[idx],
      name,
      color: request.color,
      icon: request.icon,
      excludeFromReports: request.excludeFromReports,
      parentId,
    };
    await this.repo.write<CategoryList>(
      DRIVE_FILES.categories,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
    return list[idx];
  }

  async remove(id: string): Promise<void> {
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw notFound();
    }
    if (list.some((c) => !c.archived && c.parentId === id)) {
      throw conflict(
        'This category has subcategories. Archive or move them first.',
        'category-has-subcategories',
      );
    }
    if (await this.isReferenced(id)) {
      throw conflict(
        'This category is referenced by one or more expenses. Archive it instead, or reassign those expenses first.',
        'category-in-use',
      );
    }
    // Soft delete: archive rather than remove, so historical references resolve.
    list[idx] = { ...list[idx], archived: true };
    await this.repo.write<CategoryList>(
      DRIVE_FILES.categories,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
  }

  /** Reassign every expense from the sources to the target, then archive sources. */
  async merge(targetId: string, sourceIds: string[]): Promise<Category[]> {
    if (!targetId?.trim()) {
      throw badRequest('A target category is required.');
    }
    const sources = new Set(
      (sourceIds ?? []).filter((s) => s && s.trim() && s !== targetId),
    );
    if (sources.size === 0) {
      throw badRequest('Select at least one other category to merge in.');
    }

    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    const list = [...(existing?.document.items ?? [])];

    const target = list.find((c) => c.id === targetId);
    if (!target) {
      throw notFound();
    }
    if (target.archived) {
      throw badRequest('Cannot merge into an archived category.');
    }
    if ([...sources].some((id) => !list.some((c) => c.id === id))) {
      throw notFound();
    }

    // 1. Reassign expenses across every shard.
    const manifestDoc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    if (manifestDoc) {
      const now = new Date().toISOString();
      for (const { shardName } of shardsNewestFirst(manifestDoc.document)) {
        await this.reassignShard(shardName, sources, targetId, now);
      }
    }

    // 2. Archive the merged-away sources.
    for (let i = 0; i < list.length; i++) {
      if (sources.has(list[i].id) && !list[i].archived) {
        list[i] = { ...list[i], archived: true };
      }
    }
    await this.repo.write<CategoryList>(
      DRIVE_FILES.categories,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );

    return list.filter((c) => !c.archived);
  }

  private async reassignShard(
    shardName: string,
    sources: Set<string>,
    targetId: string,
    now: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const shard = await this.repo.read<ExpenseShard>(shardName);
      if (!shard) {
        return;
      }
      if (!shard.document.items.some((e) => sources.has(e.categoryId))) {
        return; // Nothing here references a source.
      }
      const updated = shard.document.items.map((e) =>
        sources.has(e.categoryId) ? { ...e, categoryId: targetId, updatedAt: now } : e,
      );
      try {
        await this.repo.write<ExpenseShard>(
          shardName,
          { schemaVersion: SCHEMA_VERSION, items: updated },
          shard.etag,
        );
        return;
      } catch (err) {
        if (err instanceof DriveConflictError && attempt === 0) {
          continue; // Re-read and retry once.
        }
        throw err;
      }
    }
  }

  /** A parent must exist, be active, and itself be top-level (one level deep). */
  private validateParent(list: Category[], parentId: string | null, selfId: string | null): void {
    if (parentId === null) {
      return;
    }
    const parent = list.find((c) => c.id === parentId);
    if (!parent || parent.archived) {
      throw badRequest('The chosen parent category was not found.');
    }
    if (parent.id === selfId) {
      throw badRequest('A category cannot be its own parent.');
    }
    if (parent.parentId) {
      throw badRequest('Subcategories cannot be nested more than one level deep.');
    }
  }

  /** Names must be unique among active siblings (same parent), case-insensitive. */
  private nameTaken(list: Category[], name: string, parentId: string | null, selfId: string | null): boolean {
    const lower = name.toLowerCase();
    return list.some(
      (c) =>
        c.id !== selfId &&
        !c.archived &&
        (c.parentId ?? null) === parentId &&
        c.name.toLowerCase() === lower,
    );
  }

  private async isReferenced(categoryId: string): Promise<boolean> {
    const manifestDoc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    if (!manifestDoc) {
      return false;
    }
    for (const { shardName } of shardsNewestFirst(manifestDoc.document)) {
      const shard = await this.repo.read<ExpenseShard>(shardName);
      if (shard?.document.items.some((e) => e.categoryId === categoryId)) {
        return true;
      }
    }
    return false;
  }
}
