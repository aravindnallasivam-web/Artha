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

  async loadMonthly(year: number, month: number): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._monthly.set(await this.api.monthly(year, month));
    } catch (err) {
      this._error.set('Could not load monthly report.');
    } finally {
      this._loading.set(false);
    }
  }

  async loadYearly(year: number): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this._yearly.set(await this.api.yearly(year));
    } catch (err) {
      this._error.set('Could not load yearly report.');
    } finally {
      this._loading.set(false);
    }
  }
}
