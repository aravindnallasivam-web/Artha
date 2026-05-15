import { Injectable, inject, signal } from '@angular/core';
import { MonthlyReport, YearlyReport } from '../../core/models/report.model';
import { ReportsApi } from './reports.api';

@Injectable({ providedIn: 'root' })
export class ReportsStore {
  private readonly api = inject(ReportsApi);

  private readonly _monthly = signal<MonthlyReport | null>(null);
  private readonly _yearly = signal<YearlyReport | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly monthly = this._monthly.asReadonly();
  readonly yearly = this._yearly.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  // Per-key freshness: the last (key, timestamp) pair we successfully
  // loaded for monthly and yearly reports respectively. Same key + within
  // the freshness window = skip the API call.
  private _monthlyKey = '';
  private _monthlyAt = 0;
  private _yearlyKey = '';
  private _yearlyAt = 0;
  private static readonly FreshnessWindowMs = 60_000;

  async loadMonthly(year: number, month: number, force = false): Promise<void> {
    const key = `${year}-${month}`;
    if (!force
        && this._monthlyKey === key
        && Date.now() - this._monthlyAt < ReportsStore.FreshnessWindowMs
        && this._monthly() !== null) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      this._monthly.set(await this.api.monthly(year, month));
      this._monthlyKey = key;
      this._monthlyAt = Date.now();
    } catch (err) {
      this._error.set('Could not load monthly report.');
    } finally {
      this._loading.set(false);
    }
  }

  async loadYearly(year: number, force = false): Promise<void> {
    const key = `${year}`;
    if (!force
        && this._yearlyKey === key
        && Date.now() - this._yearlyAt < ReportsStore.FreshnessWindowMs
        && this._yearly() !== null) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      this._yearly.set(await this.api.yearly(year));
      this._yearlyKey = key;
      this._yearlyAt = Date.now();
    } catch (err) {
      this._error.set('Could not load yearly report.');
    } finally {
      this._loading.set(false);
    }
  }
}
