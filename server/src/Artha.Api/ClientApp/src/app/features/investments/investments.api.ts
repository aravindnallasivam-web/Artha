import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Investment, InvestmentUpsertRequest } from '../../core/models/investment.model';

@Injectable({ providedIn: 'root' })
export class InvestmentsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/investments`;

  list(includeArchived = false): Promise<Investment[]> {
    const params: Record<string, string> = {};
    if (includeArchived) params['includeArchived'] = 'true';
    return firstValueFrom(this.http.get<Investment[]>(this.baseUrl, { params }));
  }

  create(request: InvestmentUpsertRequest): Promise<Investment> {
    return firstValueFrom(this.http.post<Investment>(this.baseUrl, request));
  }

  update(id: string, request: InvestmentUpsertRequest): Promise<Investment> {
    return firstValueFrom(this.http.put<Investment>(`${this.baseUrl}/${id}`, request));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/${id}`));
  }
}
