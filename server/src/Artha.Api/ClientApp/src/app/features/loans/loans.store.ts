import { Injectable, computed, inject, signal } from '@angular/core';
import { Loan, LoanUpsertRequest } from '../../core/models/loan.model';
import { loanStats } from './loan-math';
import { LoansApi } from './loans.api';

@Injectable({ providedIn: 'root' })
export class LoansStore {
  private readonly api = inject(LoansApi);

  private readonly _items = signal<Loan[]>([]);
  private readonly _includeArchived = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private _lastLoadedAt = 0;
  private static readonly FreshnessWindowMs = 5 * 60_000;

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly active = computed(() => this._items().filter((l) => !l.archived));
  readonly byId = computed(() => {
    const map: Record<string, Loan> = {};
    for (const l of this._items()) {
      map[l.id] = l;
    }
    return map;
  });

  /** Total remaining principal across active loans. */
  readonly totalOutstanding = computed(() =>
    this.active().reduce((sum, l) => sum + loanStats(l).outstanding, 0),
  );
  /** Combined monthly EMI across active, not-yet-closed loans. */
  readonly totalMonthlyEmi = computed(() =>
    this.active().reduce((sum, l) => {
      const s = loanStats(l);
      return sum + (s.closed ? 0 : s.emi);
    }, 0),
  );

  async load(includeArchived = false, force = false): Promise<void> {
    if (
      !force &&
      this._lastLoadedAt > 0 &&
      Date.now() - this._lastLoadedAt < LoansStore.FreshnessWindowMs &&
      this._includeArchived() === includeArchived
    ) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this._includeArchived.set(includeArchived);
    try {
      this._items.set(await this.api.list(includeArchived));
      this._lastLoadedAt = Date.now();
    } catch {
      this._error.set('Could not load loans.');
    } finally {
      this._loading.set(false);
    }
  }

  async add(request: LoanUpsertRequest): Promise<Loan> {
    const created = await this.api.create(request);
    this._items.update((items) => [...items, created]);
    return created;
  }

  async update(id: string, request: LoanUpsertRequest): Promise<Loan> {
    const updated = await this.api.update(id, request);
    this._items.update((items) => items.map((l) => (l.id === id ? updated : l)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    await this.load(this._includeArchived(), /* force */ true);
  }
}
