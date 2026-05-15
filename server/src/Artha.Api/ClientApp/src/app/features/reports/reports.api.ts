import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MonthlyReport, YearlyReport } from '../../core/models/report.model';

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/reports`;

  monthly(year: number, month: number): Promise<MonthlyReport> {
    const params = new HttpParams().set('year', year).set('month', month);
    return firstValueFrom(this.http.get<MonthlyReport>(`${this.baseUrl}/monthly`, { params }));
  }

  yearly(year: number): Promise<YearlyReport> {
    const params = new HttpParams().set('year', year);
    return firstValueFrom(this.http.get<YearlyReport>(`${this.baseUrl}/yearly`, { params }));
  }
}
