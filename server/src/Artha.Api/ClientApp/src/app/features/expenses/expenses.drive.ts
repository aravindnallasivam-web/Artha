// Drive-backed expenses service — port of ExpensesController (sans import).
//
// Expenses are sharded by month (expenses-YYYY-MM.json) and tracked in
// manifest.json. Same public surface as ExpensesApi for list/create/update/
// remove; the .xlsx/.csv import endpoints are intentionally dropped.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository, RepositoryDocument } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, notFound } from '../../core/drive/drive-errors';
import { DriveConflictError } from '../../core/drive/drive-rest.client';
import {
  AccountList,
  CategoryList,
  DEFAULT_ACCOUNT_ID,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  SCHEMA_VERSION,
  SettingsDocument,
  YearMonth,
  emptyManifest,
  newId,
  shardFor,
  shardsInRange,
  shardsNewestFirst,
  ymCompare,
  ymFromDate,
  ymToString,
} from '../../core/drive/drive-schema';
import {
  Expense,
  ExpenseCreateRequest,
  ExpenseListResponse,
  ExpenseUpdateRequest,
} from '../../core/models/expense.model';

@Injectable({ providedIn: 'root' })
export class ExpensesDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  /** List expenses across the [from, to] month range (default: current month). */
  async list(from?: string, to?: string): Promise<ExpenseListResponse> {
    await this.bootstrap.ensureInitialized();
    const now = currentYearMonth();
    let fromMonth = from ? parseYearMonth(from) ?? now : now;
    let toMonth = to ? parseYearMonth(to) ?? now : now;
    if (ymCompare(fromMonth, toMonth) > 0) {
      [fromMonth, toMonth] = [toMonth, fromMonth];
    }

    const manifest = await this.readManifest();
    const items: Expense[] = [];
    for (const shardName of shardsInRange(manifest, fromMonth, toMonth)) {
      const shard = await this.repo.read<ExpenseShard>(shardName);
      if (shard) {
        items.push(...shard.document.items);
      }
    }

    const currency = await this.readCurrency();
    const sorted = items
      .map(normalizeExpense)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return { items: sorted, currency };
  }

  async create(request: ExpenseCreateRequest): Promise<Expense> {
    if (request.amount <= 0) {
      throw badRequest('Amount must be greater than zero.');
    }
    if (!request.categoryId?.trim()) {
      throw badRequest('CategoryId is required.');
    }
    await this.bootstrap.ensureInitialized();
    const accountId = request.accountId?.trim() || DEFAULT_ACCOUNT_ID;
    const currency = await this.readCurrency();

    const category = (await this.repo.read<CategoryList>(DRIVE_FILES.categories))?.document.items.find(
      (c) => c.id === request.categoryId,
    );
    if (!category || category.archived) {
      throw badRequest(`Category '${request.categoryId}' does not exist or is archived.`);
    }
    const account = (await this.repo.read<AccountList>(DRIVE_FILES.accounts))?.document.items.find(
      (a) => a.id === accountId,
    );
    if (!account || account.archived) {
      throw badRequest(`Account '${accountId}' does not exist or is archived.`);
    }

    const now = new Date().toISOString();
    const expense: Expense = {
      id: newId('exp'),
      date: request.date,
      amount: request.amount,
      currency,
      categoryId: request.categoryId,
      accountId,
      note: request.note?.trim() ? request.note.trim() : null,
      excluded: request.excluded,
      createdAt: now,
      updatedAt: now,
    };
    await this.appendToShard(expense);
    return expense;
  }

  async update(id: string, request: ExpenseUpdateRequest): Promise<Expense> {
    if (request.amount <= 0) {
      throw badRequest('Amount must be greater than zero.');
    }
    await this.bootstrap.ensureInitialized();
    const manifest = await this.readManifest();
    const located = await this.findById(manifest, id);
    if (!located) {
      throw notFound();
    }

    const { shardName, shardDoc, expense } = located;
    const oldMonth = ymFromDate(expense.date);
    const newMonth = ymFromDate(request.date);
    const accountId = request.accountId?.trim() || DEFAULT_ACCOUNT_ID;

    const updated: Expense = {
      ...expense,
      date: request.date,
      amount: request.amount,
      categoryId: request.categoryId,
      accountId,
      note: request.note?.trim() ? request.note.trim() : null,
      updatedAt: new Date().toISOString(),
      excluded: request.excluded,
    };

    if (ymCompare(oldMonth, newMonth) === 0) {
      const items = shardDoc.document.items.map((e) => (e.id === id ? updated : e));
      await this.repo.write<ExpenseShard>(
        shardName,
        { schemaVersion: SCHEMA_VERSION, items },
        shardDoc.etag,
      );
    } else {
      // Cross-month move: drop from the old shard, append to the new one.
      const trimmed = shardDoc.document.items.filter((e) => e.id !== id);
      await this.repo.write<ExpenseShard>(
        shardName,
        { schemaVersion: SCHEMA_VERSION, items: trimmed },
        shardDoc.etag,
      );
      await this.appendToShard(updated);
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.bootstrap.ensureInitialized();
    const manifest = await this.readManifest();
    const located = await this.findById(manifest, id);
    if (!located) {
      throw notFound();
    }
    const { shardName, shardDoc } = located;
    const trimmed = shardDoc.document.items.filter((e) => e.id !== id);
    await this.repo.write<ExpenseShard>(
      shardName,
      { schemaVersion: SCHEMA_VERSION, items: trimmed },
      shardDoc.etag,
    );
  }

  /**
   * Append an expense to its month's shard, creating the shard + manifest entry
   * on first use. Retries once on conflict (the id is fresh, so re-append is safe).
   */
  private async appendToShard(expense: Expense): Promise<void> {
    const month = ymFromDate(expense.date);
    const shardName = shardFor(month);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const shardDoc = await this.repo.read<ExpenseShard>(shardName);
        const items = [...(shardDoc?.document.items ?? []), expense];
        await this.repo.write<ExpenseShard>(
          shardName,
          { schemaVersion: SCHEMA_VERSION, items },
          shardDoc?.etag,
        );

        // Ensure the manifest lists this shard.
        const manifestDoc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
        const manifest = manifestDoc?.document ?? emptyManifest();
        const key = ymToString(month);
        if (!manifest.shards.includes(key)) {
          const shards = [...manifest.shards, key].sort();
          await this.repo.write<Manifest>(
            DRIVE_FILES.manifest,
            { ...manifest, shards },
            manifestDoc?.etag,
          );
        }
        return;
      } catch (err) {
        if (err instanceof DriveConflictError && attempt === 0) {
          continue; // Re-read and retry once.
        }
        throw err;
      }
    }
  }

  private async findById(
    manifest: Manifest,
    id: string,
  ): Promise<{ shardName: string; shardDoc: RepositoryDocument<ExpenseShard>; expense: Expense } | null> {
    for (const { shardName } of shardsNewestFirst(manifest)) {
      const shardDoc = await this.repo.read<ExpenseShard>(shardName);
      if (!shardDoc) {
        continue;
      }
      const expense = shardDoc.document.items.find((e) => e.id === id);
      if (expense) {
        return { shardName, shardDoc, expense };
      }
    }
    return null;
  }

  private async readManifest(): Promise<Manifest> {
    const doc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    return doc?.document ?? emptyManifest();
  }

  private async readCurrency(): Promise<string> {
    const settings = await this.repo.read<SettingsDocument>(DRIVE_FILES.settings);
    return settings?.document.currency ?? 'USD';
  }
}

function currentYearMonth(): YearMonth {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function parseYearMonth(raw: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})/.exec(raw);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** Legacy rows may lack accountId/excluded — surface sane defaults. */
function normalizeExpense(e: Expense): Expense {
  return {
    ...e,
    accountId: e.accountId || DEFAULT_ACCOUNT_ID,
    excluded: e.excluded ?? false,
  };
}
