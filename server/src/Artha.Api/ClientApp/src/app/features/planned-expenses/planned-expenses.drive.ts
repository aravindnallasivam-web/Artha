// Drive-backed planned-expenses service — port of PlannedExpensesController.
// Same public surface as PlannedExpensesApi.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest, notFound } from '../../core/drive/drive-errors';
import {
  CategoryList,
  DRIVE_FILES,
  PlannedExpenseList,
  SCHEMA_VERSION,
  newId,
} from '../../core/drive/drive-schema';
import {
  PlannedCycle,
  PlannedExpense,
  PlannedExpenseUpsertRequest,
} from '../../core/models/planned-expense.model';

@Injectable({ providedIn: 'root' })
export class PlannedExpensesDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async list(includeArchived = false): Promise<PlannedExpense[]> {
    await this.bootstrap.ensureInitialized();
    const doc = await this.repo.read<PlannedExpenseList>(DRIVE_FILES.plannedExpenses);
    return (doc?.document.items ?? []).filter((p) => includeArchived || !p.archived);
  }

  async create(request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    await this.bootstrap.ensureInitialized();
    await this.validate(request);

    const existing = await this.repo.read<PlannedExpenseList>(DRIVE_FILES.plannedExpenses);
    const list = existing?.document.items ?? [];
    const name = request.name.trim();
    if (list.some((p) => !p.archived && p.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest(`A planned expense named '${name}' already exists.`);
    }

    const created: PlannedExpense = {
      id: newId('plan'),
      name,
      amount: request.amount,
      categoryId: request.categoryId?.trim() ? request.categoryId : null,
      dayOfMonth: request.dayOfMonth,
      archived: false,
      cycle: normalizeCycle(request.cycle),
    };
    await this.repo.write<PlannedExpenseList>(
      DRIVE_FILES.plannedExpenses,
      { schemaVersion: SCHEMA_VERSION, items: [...list, created] },
      existing?.etag,
    );
    return created;
  }

  async update(id: string, request: PlannedExpenseUpsertRequest): Promise<PlannedExpense> {
    await this.bootstrap.ensureInitialized();
    await this.validate(request);

    const existing = await this.repo.read<PlannedExpenseList>(DRIVE_FILES.plannedExpenses);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw notFound();
    }
    const name = request.name.trim();
    if (list.some((p) => p.id !== id && !p.archived && p.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest(`A planned expense named '${name}' already exists.`);
    }

    list[idx] = {
      ...list[idx],
      name,
      amount: request.amount,
      categoryId: request.categoryId?.trim() ? request.categoryId : null,
      dayOfMonth: request.dayOfMonth,
      cycle: normalizeCycle(request.cycle),
    };
    await this.repo.write<PlannedExpenseList>(
      DRIVE_FILES.plannedExpenses,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
    return list[idx];
  }

  async remove(id: string): Promise<void> {
    await this.bootstrap.ensureInitialized();
    const existing = await this.repo.read<PlannedExpenseList>(DRIVE_FILES.plannedExpenses);
    const list = [...(existing?.document.items ?? [])];
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw notFound();
    }
    // Soft delete, consistent with categories/accounts.
    list[idx] = { ...list[idx], archived: true };
    await this.repo.write<PlannedExpenseList>(
      DRIVE_FILES.plannedExpenses,
      { schemaVersion: SCHEMA_VERSION, items: list },
      existing?.etag,
    );
  }

  private async validate(request: PlannedExpenseUpsertRequest): Promise<void> {
    if (!request.name?.trim()) {
      throw badRequest('Name is required.');
    }
    if (request.amount <= 0) {
      throw badRequest('Amount must be greater than zero.');
    }
    if (request.dayOfMonth !== null && (request.dayOfMonth < 1 || request.dayOfMonth > 31)) {
      throw badRequest('Day of month must be between 1 and 31.');
    }
    if (request.categoryId?.trim()) {
      const categories = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
      const category = (categories?.document.items ?? []).find((c) => c.id === request.categoryId);
      if (!category || category.archived) {
        throw badRequest('Selected category does not exist or is archived.');
      }
    }
  }
}

/** Only 'monthly' or 'yearly' are valid; anything else means monthly. */
function normalizeCycle(cycle: string | null | undefined): PlannedCycle {
  return cycle?.toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
}
