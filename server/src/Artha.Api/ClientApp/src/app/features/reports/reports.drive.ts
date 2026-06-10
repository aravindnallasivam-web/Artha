// Drive-backed reports service — port of ReportsController.
// Pure aggregation over the expense shards. Same public surface as ReportsApi.

import { Injectable, inject } from '@angular/core';
import { AppDataRepository } from '../../core/drive/app-data.repository';
import { DriveBootstrap } from '../../core/drive/drive-bootstrap.service';
import { badRequest } from '../../core/drive/drive-errors';
import {
  CategoryList,
  DRIVE_FILES,
  ExpenseShard,
  Manifest,
  PlannedExpenseList,
  SettingsDocument,
  emptyManifest,
  shardsInRange,
} from '../../core/drive/drive-schema';
import { Category } from '../../core/models/category.model';
import { Expense } from '../../core/models/expense.model';
import {
  CategoryBreakdown,
  MonthSummary,
  MonthlyReport,
  YearlyReport,
} from '../../core/models/report.model';

@Injectable({ providedIn: 'root' })
export class ReportsDriveService {
  private readonly repo = inject(AppDataRepository);
  private readonly bootstrap = inject(DriveBootstrap);

  async monthly(year: number, month: number): Promise<MonthlyReport> {
    if (month < 1 || month > 12) {
      throw badRequest('Month must be 1-12.');
    }
    await this.bootstrap.ensureInitialized();

    const manifest = await this.readManifest();
    const currency = await this.readCurrency();
    const categoriesById = await this.readCategoriesById();
    const excluded = excludedCategoryIds(categoriesById);

    const target = { year, month };
    const items: Expense[] = [];
    for (const shardName of shardsInRange(manifest, target, target)) {
      const shard = await this.repo.read<ExpenseShard>(shardName);
      if (shard) {
        items.push(...shard.document.items);
      }
    }

    const counted = items.filter(
      (e) => e.type !== 'income' && !e.excluded && !excluded.has(e.categoryId),
    );
    const perCategory = new Map<string, { total: number; count: number }>();
    for (const e of counted) {
      const prev = perCategory.get(e.categoryId) ?? { total: 0, count: 0 };
      perCategory.set(e.categoryId, { total: prev.total + e.amount, count: prev.count + 1 });
    }
    const byCategory = rollUp(perCategory, categoriesById);

    const planned = (await this.repo.read<PlannedExpenseList>(DRIVE_FILES.plannedExpenses))?.document.items.filter(
      (p) => !p.archived,
    ) ?? [];

    return {
      year,
      month,
      currency,
      total: sum(counted),
      count: counted.length,
      // A yearly planned expense contributes its monthly share (amount / 12).
      plannedTotal: planned.reduce((t, p) => t + (p.cycle === 'yearly' ? p.amount / 12 : p.amount), 0),
      plannedCount: planned.length,
      byCategory,
    };
  }

  async yearly(year: number): Promise<YearlyReport> {
    await this.bootstrap.ensureInitialized();

    const manifest = await this.readManifest();
    const currency = await this.readCurrency();
    const categoriesById = await this.readCategoriesById();
    const excluded = excludedCategoryIds(categoriesById);

    const shardNames = shardsInRange(manifest, { year, month: 1 }, { year, month: 12 });
    const shards = await Promise.all(shardNames.map((name) => this.repo.read<ExpenseShard>(name)));

    const monthTotals = new Map<number, { total: number; count: number }>();
    const catTotals = new Map<string, { total: number; count: number }>();

    for (const shard of shards) {
      if (!shard) {
        continue;
      }
      for (const e of shard.document.items) {
        if (e.type === 'income' || e.excluded || excluded.has(e.categoryId)) {
          continue;
        }
        const m = Number(e.date.slice(5, 7));
        const pm = monthTotals.get(m) ?? { total: 0, count: 0 };
        monthTotals.set(m, { total: pm.total + e.amount, count: pm.count + 1 });

        const pc = catTotals.get(e.categoryId) ?? { total: 0, count: 0 };
        catTotals.set(e.categoryId, { total: pc.total + e.amount, count: pc.count + 1 });
      }
    }

    // Always return all 12 months for chart-friendly output.
    const months: MonthSummary[] = Array.from({ length: 12 }, (_, i) => {
      const s = monthTotals.get(i + 1) ?? { total: 0, count: 0 };
      return { month: i + 1, total: s.total, count: s.count };
    });

    const byCategory = rollUp(catTotals, categoriesById);

    return {
      year,
      currency,
      yearTotal: months.reduce((t, m) => t + m.total, 0),
      yearCount: months.reduce((t, m) => t + m.count, 0),
      months,
      byCategory,
    };
  }

  private async readManifest(): Promise<Manifest> {
    const doc = await this.repo.read<Manifest>(DRIVE_FILES.manifest);
    return doc?.document ?? emptyManifest();
  }

  private async readCurrency(): Promise<string> {
    const settings = await this.repo.read<SettingsDocument>(DRIVE_FILES.settings);
    return settings?.document.currency ?? 'USD';
  }

  private async readCategoriesById(): Promise<Map<string, Category>> {
    const doc = await this.repo.read<CategoryList>(DRIVE_FILES.categories);
    return new Map((doc?.document.items ?? []).map((c) => [c.id, c]));
  }
}

function excludedCategoryIds(categoriesById: Map<string, Category>): Set<string> {
  const excluded = new Set(
    [...categoriesById.values()].filter((c) => c.excludeFromReports).map((c) => c.id),
  );
  // Excluding a parent also excludes its subcategories.
  for (const c of categoriesById.values()) {
    if (c.parentId && excluded.has(c.parentId)) {
      excluded.add(c.id);
    }
  }
  return excluded;
}

/**
 * Group per-category totals up to their top-level category. Each top-level
 * entry carries the rolled-up total, plus a `children` split of any subcategory
 * spend, so the UI can show a parent total and drill into its subcategories.
 */
function rollUp(
  perCategory: Map<string, { total: number; count: number }>,
  categoriesById: Map<string, Category>,
): CategoryBreakdown[] {
  const roots = new Map<
    string,
    { total: number; count: number; children: Map<string, { total: number; count: number }> }
  >();
  for (const [categoryId, v] of perCategory) {
    const cat = categoriesById.get(categoryId);
    const rootId = cat?.parentId ?? categoryId;
    const root = roots.get(rootId) ?? { total: 0, count: 0, children: new Map() };
    root.total += v.total;
    root.count += v.count;
    if (cat?.parentId) {
      const cv = root.children.get(categoryId) ?? { total: 0, count: 0 };
      cv.total += v.total;
      cv.count += v.count;
      root.children.set(categoryId, cv);
    }
    roots.set(rootId, root);
  }

  const name = (id: string): string => categoriesById.get(id)?.name ?? '(Unknown)';
  return [...roots.entries()]
    .map(([rootId, r]) => {
      const children = [...r.children.entries()]
        .map(([id, v]) => ({ categoryId: id, categoryName: name(id), total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total);
      return {
        categoryId: rootId,
        categoryName: name(rootId),
        total: r.total,
        count: r.count,
        children: children.length ? children : undefined,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function sum(items: Expense[]): number {
  return items.reduce((t, e) => t + e.amount, 0);
}
