// Thin pass-through to the Drive-backed service. Kept as `ReportsApi` so the
// store's injection point is unchanged after the serverless cutover.
import { Injectable, inject } from '@angular/core';
import { MonthlyReport, YearlyReport } from '../../core/models/report.model';
import { ReportsDriveService } from './reports.drive';

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly drive = inject(ReportsDriveService);

  monthly(year: number, month: number): Promise<MonthlyReport> {
    return this.drive.monthly(year, month);
  }

  yearly(year: number): Promise<YearlyReport> {
    return this.drive.yearly(year);
  }
}
